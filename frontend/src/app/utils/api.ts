/** Normalize API base URL — avoids `//agent/...` when env has a trailing slash. */

const DEFAULT_API_BASE = "http://127.0.0.1:8000";

export function normalizeApiBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function getApiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE;
  return normalizeApiBase(raw);
}

export function apiUrl(path: string, base: string = getApiBase()): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizeApiBase(base)}${normalizedPath}`;
}
