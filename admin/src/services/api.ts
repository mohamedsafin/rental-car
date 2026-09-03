/**
 * services/api.ts
 * ---------------------------------------------------------------------------
 * The ONE Axios instance for this app. Nothing calls `fetch` or `axios`
 * directly anywhere else.
 *
 * Why centralise:
 *  - one place for the base URL, timeout and credentials
 *  - one place to attach the auth token (Phase 2)
 *  - one place to turn any backend/network failure into the same
 *    `NormalisedApiError`, so components never inspect raw Axios errors
 */
import axios, { AxiosError, type AxiosInstance } from 'axios';
import type { ApiFailure, ApiSuccess, NormalisedApiError } from '../types/api';

const baseURL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1';

export const api: AxiosInstance = axios.create({
  baseURL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
  // Needed later for refresh-token cookies.
  withCredentials: false,
});

// --- Request interceptor ---------------------------------------------------
api.interceptors.request.use((config) => {
  // Phase 2 will read the access token from the auth store and set:
  //   config.headers.Authorization = `Bearer ${token}`;
  return config;
});

function networkMessage(error: AxiosError): string {
  if (error.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
  return 'Cannot reach the server. Please check your connection and try again.';
}

// --- Response interceptor --------------------------------------------------
// Normalise every failure so components never inspect a raw Axios error.
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiFailure>) => {
    const normalised: NormalisedApiError = {
      message: error.response?.data?.message ?? networkMessage(error),
      code: error.response?.data?.code ?? 'NETWORK_ERROR',
      status: error.response?.status ?? 0,
      errors: error.response?.data?.errors ?? [],
      requestId: error.response?.data?.requestId,
    };
    return Promise.reject(normalised);
  },
);

/** GET a resource and return just the `data` payload. */
export async function getData<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const response = await api.get<ApiSuccess<T>>(url, { params });
  return response.data.data;
}

/** POST a body and return just the `data` payload. */
export async function postData<T, B = unknown>(url: string, body?: B): Promise<T> {
  const response = await api.post<ApiSuccess<T>>(url, body);
  return response.data.data;
}
