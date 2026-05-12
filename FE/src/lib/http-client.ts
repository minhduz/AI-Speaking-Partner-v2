const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
const SESSION_KEY = '__sp_access_token';

const inBrowser = globalThis.window !== undefined;

// Module-level cache; may be cleared by HMR — sessionStorage acts as fallback
let _accessToken: string | null = inBrowser ? sessionStorage.getItem(SESSION_KEY) : null;

export function setAccessToken(token: string | null): void {
  _accessToken = token;
  if (inBrowser) {
    if (token) sessionStorage.setItem(SESSION_KEY, token);
    else sessionStorage.removeItem(SESSION_KEY);
  }
}

export function getAccessToken(): string | null {
  return _accessToken ?? (inBrowser ? sessionStorage.getItem(SESSION_KEY) : null);
}

// Singleton refresh promise — deduplicates concurrent 401 retries
let _refreshPromise: Promise<string | null> | null = null;

async function tryRefresh(): Promise<string | null> {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
    .then(r => r.ok ? r.json() : Promise.reject(new Error('Refresh failed')))
    .then(({ access_token }: { access_token: string }) => {
      setAccessToken(access_token);
      return access_token;
    })
    .catch(() => {
      setAccessToken(null);
      return null;
    })
    .finally(() => { _refreshPromise = null; });
  return _refreshPromise;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  };

  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (res.status === 401 && retry) {
    const newToken = await tryRefresh();
    if (!newToken) throw new Error('Session expired. Please log in again.');
    return request<T>(path, init, false); // retry once with refreshed token
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message ?? 'Request failed');
  }

  return res.json() as Promise<T>;
}

export const httpClient = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
