import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { agentFetch } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const token = cookies().get("erp_session")?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const upstream = await agentFetch(session, "/conversations");
    const j = await upstream.json();
    const convs = j.conversations ?? [];
    if (!convs.length) return NextResponse.json({ messages: [] });
    const msgs = await agentFetch(session, `/conversations/${convs[0].id}/messages`);
    const mj = await msgs.json();
    return NextResponse.json({ messages: mj.messages ?? [] });
  } catch {
    return NextResponse.json({ messages: [] });
  }
}