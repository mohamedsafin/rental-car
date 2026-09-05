/**
 * services/storage/localProvider.ts
 * ---------------------------------------------------------------------------
 * Development driver: writes to the local filesystem under STORAGE_LOCAL_PATH.
 *
 * Fine for development and a single-server deployment. NOT suitable for
 * multi-instance production - two servers behind a load balancer would each
 * hold half the images. That is exactly why the interface exists: swapping to
 * S3 in Phase 11 is a config change plus one new file.
 *
 * Two safety measures worth noting:
 *
 *  1. Filenames are generated, never taken from the upload. A browser-supplied
 *     name like `../../../.env` or `shell.php` must never reach the filesystem.
 *  2. Every resolved path is checked to be inside the storage root, so even a
 *     bug in key construction cannot write or read outside it.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { env } from '../../config/env';
import { ApiError, ErrorCode } from '../../utils/ApiError';
import type { StorageProvider, StoredFile, StoredObject, UploadInput } from './types';

/** Extension is derived from the VERIFIED mime type, never from the filename. */
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

const PUBLIC_ROOT = 'public';
const PRIVATE_ROOT = 'private';

export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';

  private readonly root: string;
  private readonly publicBaseUrl: string;

  constructor() {
    this.root = path.resolve(process.cwd(), env.STORAGE_LOCAL_PATH);
    this.publicBaseUrl = `${env.PUBLIC_API_URL}/uploads`;
  }

  /**
   * Every file under the storage root, as provider keys.
   *
   * Used by the orphaned-file sweep. Walks both `public/` and `private/`,
   * because an identity document left behind after its row is gone is exactly
   * the case worth finding.
   */
  async list(): Promise<StoredObject[]> {
    const found: StoredObject[] = [];

    const walk = async (directory: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        // The root may not exist yet on a fresh install. Nothing stored is
        // not an error.
        return;
      }

      for (const entry of entries) {
        const absolute = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          await walk(absolute);
          continue;
        }
        if (!entry.isFile()) continue;

        const stats = await fs.stat(absolute);
        found.push({
          // Keys are POSIX-style everywhere else in the system, so normalise
          // Windows separators rather than leaking them into comparisons.
          key: path.relative(this.root, absolute).split(path.sep).join('/'),
          sizeBytes: stats.size,
          modifiedAt: stats.mtime,
        });
      }
    };

    await walk(this.root);
    return found;
  }

  /** Resolve a key to an absolute path, refusing anything outside the root. */
  private resolveSafe(key: string): string {
    const resolved = path.resolve(this.root, key);
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;

    if (!resolved.startsWith(rootWithSep)) {
      // A traversal attempt, or a bug that built a key with '..' in it.
      throw new ApiError(400, 'Invalid file path', ErrorCode.FILE_UPLOAD_ERROR);
    }
    return resolved;
  }

  async upload(input: UploadInput): Promise<StoredFile> {
    const extension = EXTENSION_BY_MIME[input.mimeType];
    if (!extension) {
      throw new ApiError(400, `Unsupported file type: ${input.mimeType}`, ErrorCode.FILE_UPLOAD_ERROR);
    }

    // Random name: unguessable, collision-free, and it discards whatever the
    // browser claimed the file was called.
    const filename = `${crypto.randomUUID()}${extension}`;
    const visibilityRoot = input.visibility === 'public' ? PUBLIC_ROOT : PRIVATE_ROOT;
    const key = path.posix.join(visibilityRoot, input.folder, filename);

    const absolutePath = this.resolveSafe(key);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, input.buffer);

    return { key, sizeBytes: input.buffer.length, mimeType: input.mimeType };
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolveSafe(key));
    } catch (error) {
      // Already gone is a success from the caller's point of view.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async getUrl(key: string): Promise<string> {
    if (key.startsWith(`${PRIVATE_ROOT}/`)) {
      // Private files are never served as a static URL. They go through an
      // authorised route that checks who is asking (Phase 5).
      throw new ApiError(403, 'This file is not publicly accessible', ErrorCode.FORBIDDEN);
    }
    // Strip the 'public/' prefix: it is an implementation detail of where the
    // file sits, not part of the URL clients use.
    return `${this.publicBaseUrl}/${key.slice(PUBLIC_ROOT.length + 1)}`;
  }

  async getStream(key: string): Promise<NodeJS.ReadableStream> {
    return createReadStream(this.resolveSafe(key));
  }

  /** Absolute path of the directory Express serves publicly. */
  publicDirectory(): string {
    return path.join(this.root, PUBLIC_ROOT);
  }
}
