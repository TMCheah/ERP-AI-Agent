import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { agentFetch } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSession() {
  const token = cookies().get("erp_session")?.value;
  return token ? await verifyToken(token) : null;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const upstream = await agentFetch(session, "/settings");
  return NextResponse.json(await upstream.json(), { status: upstream.status });
}

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "ADMIN")
    return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const body = await req.json();
  const upstream = await agentFetch(session, "/settings", {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return NextResponse.json(await upstream.json(), { status: upstream.status });
}