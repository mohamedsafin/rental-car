/**
 * services/storage/types.ts
 * ---------------------------------------------------------------------------
 * The storage contract.
 *
 * BRD 51 leaves the file host to the client, so nothing in the business code
 * may know whether a file sits on this disk, in S3 or in Cloudinary. Modules
 * depend on this interface; the concrete driver is chosen once, in index.ts,
 * from STORAGE_DRIVER.
 *
 * The `visibility` split is the important part. Vehicle photos are marketing
 * material and should be publicly cacheable. Customer documents - Emirates ID,
 * passport, driving licence - must NEVER be reachable by URL guessing, which is
 * what BRD 12 means by "do not expose private documents". Encoding that as a
 * required argument means Phase 5 cannot store an Emirates ID publicly by
 * forgetting a flag.
 */

export type StorageVisibility = 'public' | 'private';

export interface StoredFile {
  /// Opaque provider key. This is what goes in the database, never a URL.
  key: string;
  sizeBytes: number;
  mimeType: string;
}

export interface UploadInput {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  /// Logical folder, e.g. 'vehicles/<vehicleId>'.
  folder: string;
  visibility: StorageVisibility;
}

export interface StorageProvider {
  readonly name: string;

  upload(input: UploadInput): Promise<StoredFile>;

  delete(key: string): Promise<void>;

  /**
   * Build a URL for a stored key.
   *
   * For public files this is a plain, cacheable URL. For private files a
   * driver should return a short-lived signed URL - which is why this is async
   * and takes an expiry, even though the local driver ignores it.
   */
  getUrl(key: string, options?: { expiresInSeconds?: number }): Promise<string>;

  /** Read a private file back, for streaming it through an authorised route. */
  getStream?(key: string): Promise<NodeJS.ReadableStream>;
}
