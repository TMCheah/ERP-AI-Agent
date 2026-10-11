import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { agentFetch } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const token = cookies().get("erp_session")?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const upstream = await agentFetch(session, `/approvals/${params.id}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const json = await upstream.json().catch(() => ({}));
  return NextResponse.json(json, { status: upstream.status });
}