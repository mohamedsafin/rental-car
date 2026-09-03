/**
 * middleware/errorHandler.ts
 * ---------------------------------------------------------------------------
 * The ONE place that turns a thrown error into an HTTP response.
 *
 * Responsibilities:
 *  - Map known error types (ApiError, ZodError, Prisma errors) to safe messages
 *    and correct status codes.
 *  - Never leak stack traces, SQL, credentials or secrets to the client.
 *  - Log the full detail server-side, with the request id, so we can debug.
 *
 * Must be registered LAST, after all routes, and must take 4 arguments —
 * that 4-arg signature is how Express recognises an error handler.
 */
import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { ApiError, ErrorCode, type ErrorCodeValue, type FieldError } from '../utils/ApiError';
import type { ErrorResponse } from '../utils/apiResponse';
import { isProduction } from '../config/env';
import { logger } from '../config/logger';

interface NormalisedError {
  statusCode: number;
  message: string;
  code: ErrorCodeValue;
  errors: FieldError[];
  /** Detail for the server log only — never sent to the client. */
  logDetail?: string;
}

function normalise(error: unknown): NormalisedError {
  if (error instanceof ApiError) {
    return {
      statusCode: error.statusCode,
      message: error.message,
      code: error.code,
      errors: error.errors,
      logDetail: error.stack,
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      message: 'Validation failed',
      code: ErrorCode.VALIDATION_ERROR,
      errors: error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // Translate Prisma codes to business-safe messages. We never forward the
    // raw Prisma message, which can contain table and column names.
    switch (error.code) {
      case 'P2002': {
        const target = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'field';
        return {
          statusCode: 409,
          message: `A record with this ${target} already exists`,
          code: ErrorCode.CONFLICT,
          errors: [],
          logDetail: error.message,
        };
      }
      case 'P2025':
        return {
          statusCode: 404,
          message: 'Resource not found',
          code: ErrorCode.NOT_FOUND,
          errors: [],
          logDetail: error.message,
        };
      case 'P2003':
        return {
          statusCode: 409,
          message: 'Related record is missing or still in use',
          code: ErrorCode.CONFLICT,
          errors: [],
          logDetail: error.message,
        };
      default:
        return {
          statusCode: 500,
          message: 'A database error occurred',
          code: ErrorCode.INTERNAL_ERROR,
          errors: [],
          logDetail: error.message,
        };
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return {
      statusCode: 500,
      message: 'A database error occurred',
      code: ErrorCode.INTERNAL_ERROR,
      errors: [],
      logDetail: error.message,
    };
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return {
      statusCode: 503,
      message: 'Service temporarily unavailable',
      code: ErrorCode.INTERNAL_ERROR,
      errors: [],
      logDetail: error.message,
    };
  }

  return {
    statusCode: 500,
    message: 'Something went wrong',
    code: ErrorCode.INTERNAL_ERROR,
    errors: [],
    logDetail: error instanceof Error ? error.stack : String(error),
  };
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const { statusCode, message, code, errors, logDetail } = normalise(error);

  const logMeta = {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    statusCode,
    code,
    // Stack traces are only worth logging for genuine server faults. A 404 or a
    // validation error is expected traffic, not something to debug.
    ...(statusCode >= 500 ? { detail: logDetail } : {}),
  };

  if (statusCode >= 500) logger.error(message, logMeta);
  else logger.warn(message, logMeta);

  const body: ErrorResponse = {
    success: false,
    // In production a 500 never reveals internals — clients get a generic line
    // plus the request id so support can look it up.
    message: statusCode >= 500 && isProduction ? 'Something went wrong' : message,
    code,
    errors,
    requestId: req.requestId,
  };

  res.status(statusCode).json(body);
}
