/**
 * middleware/upload.ts
 * ---------------------------------------------------------------------------
 * Multipart upload handling and file validation (BRD 46 "file upload
 * validation").
 *
 * Files are held in MEMORY, not written to a temp directory, so an upload that
 * fails validation never touches the disk at all. The size cap keeps that safe.
 *
 * Validation happens twice, and the second check is the one that matters:
 *
 *  1. Multer checks the declared MIME type and file size. Cheap, and rejects
 *     most mistakes early.
 *
 *  2. `assertRealImage` checks the file's MAGIC BYTES. A declared MIME type is
 *     just a string the client chose - anyone can upload `payload.php` with
 *     `Content-Type: image/jpeg`. The first bytes of a real JPEG cannot be
 *     faked without the file actually being a JPEG.
 */
import multer from 'multer';
import type { Request } from 'express';
import { env } from '../config/env';
import { ApiError, ErrorCode } from '../utils/ApiError';

const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;

/**
 * Identity documents additionally allow PDF: an Emirates ID or a visa page is
 * very often issued as one. Everything else stays out - a document upload is
 * not a general file drop.
 */
const ALLOWED_DOCUMENT_MIME = [...ALLOWED_IMAGE_MIME, 'application/pdf'] as const;

/**
 * Leading bytes that identify each format.
 * JPEG: FF D8 FF          PNG: 89 50 4E 47 0D 0A 1A 0A
 * WebP: "RIFF" ....  "WEBP" at offset 8
 */
const MAGIC_BYTES: Record<string, (buffer: Buffer) => boolean> = {
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) =>
    b.length > 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a,
  'image/webp': (b) =>
    b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  // PDF: the file must literally begin with "%PDF-".
  'application/pdf': (b) => b.length > 5 && b.toString('ascii', 0, 5) === '%PDF-',
};

function imageFileFilter(
  _req: Request,
  file: Express.Multer.File,
  callback: multer.FileFilterCallback,
): void {
  if (!ALLOWED_IMAGE_MIME.includes(file.mimetype as (typeof ALLOWED_IMAGE_MIME)[number])) {
    callback(
      new ApiError(
        400,
        `Unsupported file type. Allowed: ${ALLOWED_IMAGE_MIME.join(', ')}`,
        ErrorCode.FILE_UPLOAD_ERROR,
      ),
    );
    return;
  }
  callback(null, true);
}

/** Upload handler for vehicle images: up to 10 files per request. */
export const uploadVehicleImages = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
    files: 10,
  },
  fileFilter: imageFileFilter,
}).array('images', 10);

/**
 * Upload handler for customer identity documents: ONE file per request.
 *
 * One at a time is deliberate. Each document carries its own type, number and
 * expiry date, and a batch upload would either lose that detail or need a
 * parallel array of metadata that can fall out of step with the files.
 */
export const uploadCustomerDocument = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
    files: 1,
  },
  fileFilter(_req, file, callback) {
    if (!ALLOWED_DOCUMENT_MIME.includes(file.mimetype as (typeof ALLOWED_DOCUMENT_MIME)[number])) {
      callback(
        new ApiError(
          400,
          `Unsupported file type. Upload a JPEG, PNG, WebP or PDF.`,
          ErrorCode.FILE_UPLOAD_ERROR,
        ),
      );
      return;
    }
    callback(null, true);
  },
}).single('document');

/**
 * Verify the bytes match the declared type. Call this in the service, on every
 * uploaded file, before anything is stored.
 */
export function assertRealImage(file: Express.Multer.File): void {
  const check = MAGIC_BYTES[file.mimetype];

  if (!check || !check(file.buffer)) {
    throw new ApiError(
      400,
      `"${file.originalname}" is not a valid ${file.mimetype} file`,
      ErrorCode.FILE_UPLOAD_ERROR,
    );
  }
}

/** Translate multer's own errors into our standard envelope. */
/**
 * Same magic-byte check, extended to PDF. Kept as its own export so the
 * intent at each call site is explicit about what it accepts.
 */
export function assertRealDocument(file: Express.Multer.File): void {
  const check = MAGIC_BYTES[file.mimetype];

  if (!check || !check(file.buffer)) {
    throw new ApiError(
      400,
      `"${file.originalname}" does not appear to be a valid ${file.mimetype} file`,
      ErrorCode.FILE_UPLOAD_ERROR,
    );
  }
}

export function normaliseMulterError(error: unknown): ApiError | null {
  if (!(error instanceof multer.MulterError)) return null;

  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return new ApiError(
        400,
        `File is too large. Maximum size is ${env.MAX_UPLOAD_SIZE_MB}MB.`,
        ErrorCode.FILE_UPLOAD_ERROR,
      );
    case 'LIMIT_FILE_COUNT':
      return new ApiError(400, 'Too many files in one request.', ErrorCode.FILE_UPLOAD_ERROR);
    case 'LIMIT_UNEXPECTED_FILE':
      return new ApiError(400, `Unexpected field "${error.field}".`, ErrorCode.FILE_UPLOAD_ERROR);
    default:
      return new ApiError(400, 'File upload failed.', ErrorCode.FILE_UPLOAD_ERROR);
  }
}
