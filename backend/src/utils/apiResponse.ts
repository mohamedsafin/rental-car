/**
 * utils/apiResponse.ts
 * ---------------------------------------------------------------------------
 * Every successful response in this API has the same shape:
 *
 *   { "success": true, "data": {...}, "message": "..." }
 *
 * Every failure has:
 *
 *   { "success": false, "message": "...", "code": "...", "errors": [] }
 *
 * Consistency here is what lets the React apps share one Axios layer.
 */
import type { Response } from 'express';
import type { ErrorCodeValue, FieldError } from './ApiError';

export interface SuccessResponse<T> {
  success: true;
  data: T;
  message: string;
}

export interface ErrorResponse {
  success: false;
  message: string;
  code: ErrorCodeValue;
  errors: FieldError[];
  requestId?: string;
}

export interface PaginatedData<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function sendSuccess<T>(res: Response, data: T, message = 'Success', statusCode = 200): Response {
  const body: SuccessResponse<T> = { success: true, data, message };
  return res.status(statusCode).json(body);
}

export function sendCreated<T>(res: Response, data: T, message = 'Created'): Response {
  return sendSuccess(res, data, message, 201);
}

export function sendPaginated<T>(
  res: Response,
  items: T[],
  page: number,
  limit: number,
  total: number,
  message = 'Success',
): Response {
  return sendSuccess<PaginatedData<T>>(
    res,
    {
      items,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    },
    message,
  );
}
