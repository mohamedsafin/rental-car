/**
 * utils/ApiError.ts
 * ---------------------------------------------------------------------------
 * One error class for every *expected* failure the API can produce.
 *
 * Rule for the whole project: services throw `ApiError`, the central error
 * handler turns it into an HTTP response. Controllers never build error
 * responses by hand, and we never leak stack traces or DB messages to clients.
 */

/** Machine-readable error codes. Frontends switch on these, not on messages. */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  VEHICLE_UNAVAILABLE: 'VEHICLE_UNAVAILABLE',
  PAYMENT_ERROR: 'PAYMENT_ERROR',
  FILE_UPLOAD_ERROR: 'FILE_UPLOAD_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** A single field-level problem, e.g. `{ field: 'email', message: 'Invalid' }`. */
export interface FieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCodeValue;
  public readonly errors: FieldError[];
  /** `true` = a failure we anticipated and can safely describe to the client. */
  public readonly isOperational: boolean;

  constructor(
    statusCode: number,
    message: string,
    code: ErrorCodeValue = ErrorCode.INTERNAL_ERROR,
    errors: FieldError[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.errors = errors;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Bad request', errors: FieldError[] = []): ApiError {
    return new ApiError(400, message, ErrorCode.VALIDATION_ERROR, errors);
  }

  static unauthorized(message = 'Authentication required'): ApiError {
    return new ApiError(401, message, ErrorCode.UNAUTHORIZED);
  }

  static forbidden(message = 'You do not have permission to perform this action'): ApiError {
    return new ApiError(403, message, ErrorCode.FORBIDDEN);
  }

  static notFound(message = 'Resource not found'): ApiError {
    return new ApiError(404, message, ErrorCode.NOT_FOUND);
  }

  static conflict(message = 'Resource conflict', code: ErrorCodeValue = ErrorCode.CONFLICT): ApiError {
    return new ApiError(409, message, code);
  }

  static internal(message = 'Something went wrong'): ApiError {
    return new ApiError(500, message, ErrorCode.INTERNAL_ERROR);
  }
}
