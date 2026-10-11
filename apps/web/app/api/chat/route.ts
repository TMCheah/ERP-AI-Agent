import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { agentFetch } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const token = cookies().get("erp_session")?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session) return new Response("Unauthorized", { status: 401 });

  const body = await req.json();
  const upstream = await agentFetch(session, "/chat", {
    method: "POST",
    body: JSON.stringify(body),
  });

  // Pipe SSE straight through to the browser.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}