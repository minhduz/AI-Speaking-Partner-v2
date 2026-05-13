import type { LoginRequest, RegisterRequest } from '@/types/auth.types';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? 'Request failed');
  return data as T;
}

export const authService = {
  login: (credentials: LoginRequest) =>
    post<{ access_token: string }>('/api/auth/login', credentials),

  register: (data: RegisterRequest) =>
    post<{ access_token: string }>('/api/auth/register', data),

  googleAuth: (credential: string) =>
    post<{ access_token: string; isNewUser: boolean }>('/api/auth/google', { credential }),

  refresh: () =>
    post<{ access_token: string }>('/api/auth/refresh', {}),

  logout: () =>
    post<{ success: boolean }>('/api/auth/logout', {}),
};
