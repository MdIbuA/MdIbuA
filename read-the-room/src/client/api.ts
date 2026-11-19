import { showLoginPrompt } from '@devvit/web/client';
import type { ErrorResponse } from '../shared/api';

export class ApiError extends Error {
  constructor(
    message: string,
    public code?: ErrorResponse['code'],
  ) {
    super(message);
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T | ErrorResponse;
  if (!res.ok) {
    const err = data as ErrorResponse;
    if (err.code === 'LOGIN_REQUIRED') showLoginPrompt();
    throw new ApiError(err.error ?? `Request failed (${res.status})`, err.code);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
};
