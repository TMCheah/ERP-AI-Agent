import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { agentFetch } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = cookies().get("erp_session")?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "PENDING";
  const upstream = await agentFetch(session, `/approvals?status=${encodeURIComponent(status)}`);
  const json = await upstream.json();
  return NextResponse.json(json, { status: upstream.status });
}