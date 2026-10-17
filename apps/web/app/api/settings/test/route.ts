import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { agentFetch } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const token = cookies().get("erp_session")?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "ADMIN")
    return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const body = await req.json();
  try {
    const upstream = await agentFetch(session, "/settings/test", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const data = await upstream
      .json()
      .catch(() => ({ ok: false, message: "Agent returned an invalid response" }));
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { ok: false, message: "Can't reach the agent server. Is it running on port 8787?" },
      { status: 502 },
    );
  }
}