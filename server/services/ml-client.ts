// server/services/ml-client.ts
//
// SEC-1: the ML service is a private plane. It is not exposed to the host in
// compose, and every request from Node carries a shared service token
// (X-Service-Token). Admin-triggering calls also forward the acting user's id
// (X-Actor) so the Python side can audit-log who invoked train / promote /
// drift-reference. This is the ONLY place Node builds ML requests, so the token
// can never be forgotten on a call site.

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

export function mlHeaders(opts?: { json?: boolean; actorId?: number | string | null }): Record<string, string> {
  const h: Record<string, string> = {};
  if (opts?.json) h["Content-Type"] = "application/json";
  const token = process.env.ML_SERVICE_TOKEN;
  if (token) h["X-Service-Token"] = token;
  if (opts?.actorId !== undefined && opts?.actorId !== null) h["X-Actor"] = String(opts.actorId);
  return h;
}

/**
 * fetch() wrapper for the ML service. Prepends ML_SERVICE_URL and injects the
 * service token (+ optional actor id). Pass a relative path like "/train".
 */
export async function mlFetch(
  path: string,
  init: RequestInit = {},
  opts?: { actorId?: number | string | null },
): Promise<Response> {
  const hasBody = init.body !== undefined && init.body !== null;
  const headers = {
    ...mlHeaders({ json: hasBody, actorId: opts?.actorId }),
    ...(init.headers as Record<string, string> | undefined),
  };
  return fetch(`${ML_SERVICE_URL}${path}`, { ...init, headers });
}

export { ML_SERVICE_URL };
