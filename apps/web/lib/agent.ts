import type { Session } from "./auth";

const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:8787";

export function agentHeaders(session: Session): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-tenant-id": session.tenantId,
    "x-user-id": session.userId,
    "x-user-role": session.role,
  };
}

export async function agentFetch(
  session: Session,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${AGENT_URL}${path}`, {
    ...init,
    headers: { ...agentHeaders(session), ...(init.headers as any) },
  });
}

export { AGENT_URL };