/**
 * services/tokenStore.ts
 * ---------------------------------------------------------------------------
 * Holds the access token IN MEMORY ONLY. Deliberately not localStorage.
 *
 * localStorage is readable by any JavaScript on the page, so a single XSS bug -
 * in our code or in any dependency - hands an attacker the token. A module
 * variable is not perfectly safe either, but it dies with the tab and is not
 * sitting in a well-known place that every credential-stealing script checks.
 *
 * The cost: a page refresh loses the token. That is fine, because the refresh
 * token lives in an httpOnly cookie the browser sends automatically, so the app
 * silently calls /auth/refresh on boot and gets a new access token. The user
 * stays logged in without us ever persisting a credential in readable storage.
 */
let accessToken: string | null = null;

/**
 * Who this token belongs to.
 *
 * Kept alongside the token so a silent renewal can be checked against the
 * person who signed in. A renewal that comes back as somebody else is not a
 * session to carry on with - it is how an admin ends up looking at a screen
 * labelled with their own name and filled with another account's permissions.
 */
let userId: string | null = null;

/** Notified on change, so the Axios layer and React stay in step. */
const listeners = new Set<(token: string | null) => void>();

export const tokenStore = {
  get: (): string | null => accessToken,

  set(token: string | null): void {
    accessToken = token;
    listeners.forEach((listener) => listener(token));
  },

  getUserId: (): string | null => userId,

  setUserId(id: string | null): void {
    userId = id;
  },

  clear(): void {
    userId = null;
    tokenStore.set(null);
  },

  subscribe(listener: (token: string | null) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
