"use client";

/**
 * Client-side fetch wrapper for state-changing requests. Reads the readable CSRF
 * cookie and echoes it in the x-csrf-token header (signed double-submit). Use for
 * all POST/PUT/PATCH/DELETE calls to our API from the browser.
 */
const CSRF_COOKIE = "contest_csrf";
const CSRF_HEADER = "x-csrf-token";

function readCookie(name: string): string | undefined {
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`));
  return match?.split("=").slice(1).join("=");
}

export async function apiFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) {
    headers.set("content-type", "application/json");
  }
  // Attach CSRF for mutating methods.
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = readCookie(CSRF_COOKIE);
    if (token) headers.set(CSRF_HEADER, token);
  }
  return fetch(input, { ...init, headers, credentials: "same-origin" });
}
