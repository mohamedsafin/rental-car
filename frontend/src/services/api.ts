/**
 * services/api.ts
 * ---------------------------------------------------------------------------
 * The ONE Axios instance. Nothing calls `fetch` or `axios` directly elsewhere.
 *
 * It does three things no component should have to think about:
 *
 *  1. Attaches the access token to every request.
 *  2. Sends cookies (`withCredentials`), so the httpOnly refresh cookie reaches
 *     /auth/refresh.
 *  3. On a 401, transparently refreshes the token and REPLAYS the failed
 *     request - so a user filling in a booking form at minute 16 does not get
 *     bounced to the login page mid-sentence.
 *
 * The queue in (3) matters: if five requests fire at once and all get 401, we
 * must refresh ONCE and replay all five. Refreshing five times in parallel
 * would rotate the token five times, and the token-reuse detector on the
 * backend would correctly treat that as theft and log the user out entirely.
 */
import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import type { ApiFailure, ApiSuccess, NormalisedApiError } from '../types/api';
import { tokenStore } from './tokenStore';

const baseURL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1';

export const api: AxiosInstance = axios.create({
  baseURL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
  // Required for the httpOnly refresh cookie to be sent and set.
  withCredentials: true,
});

/** Requests that must never trigger a refresh attempt (they ARE the auth flow). */
const AUTH_PATHS = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];

/** Called when refreshing fails for good - the app should return to login. */
let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(handler: () => void): void {
  onSessionExpired = handler;
}

// --- Request: attach the token --------------------------------------------
api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// --- Response: refresh once, replay everything ----------------------------
let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  // A bare axios call, not `api`: using the instance would re-enter this
  // interceptor and recurse forever.
  const response = await axios.post<ApiSuccess<{ accessToken: string }>>(
    `${baseURL}/auth/refresh`,
    {},
    { withCredentials: true },
  );
  const token = response.data.data.accessToken;
  tokenStore.set(token);
  return token;
}

function networkMessage(error: AxiosError): string {
  if (error.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
  return 'Cannot reach the server. Please check your connection and try again.';
}

function normalise(error: AxiosError<ApiFailure>): NormalisedApiError {
  return {
    message: error.response?.data?.message ?? networkMessage(error),
    code: error.response?.data?.code ?? 'NETWORK_ERROR',
    status: error.response?.status ?? 0,
    errors: error.response?.data?.errors ?? [],
    requestId: error.response?.data?.requestId,
  };
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiFailure>) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;

    const isAuthPath = AUTH_PATHS.some((path) => original?.url?.includes(path));
    const shouldRefresh =
      error.response?.status === 401 && original && !original._retried && !isAuthPath;

    if (shouldRefresh) {
      original._retried = true;
      try {
        // Every concurrent 401 awaits the SAME promise, so exactly one refresh
        // request is sent no matter how many requests failed together.
        refreshPromise = refreshPromise ?? refreshAccessToken();
        const token = await refreshPromise;
        refreshPromise = null;

        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch {
        refreshPromise = null;
        tokenStore.clear();
        onSessionExpired?.();
        return Promise.reject({
          message: 'Your session has expired. Please log in again.',
          code: 'SESSION_EXPIRED',
          status: 401,
          errors: [],
        } satisfies NormalisedApiError);
      }
    }

    return Promise.reject(normalise(error));
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

/** PATCH a body and return just the `data` payload. */
export async function patchData<T, B = unknown>(url: string, body?: B): Promise<T> {
  const response = await api.patch<ApiSuccess<T>>(url, body);
  return response.data.data;
}
