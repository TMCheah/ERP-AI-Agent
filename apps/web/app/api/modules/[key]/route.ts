import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { agentFetch } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { key: string } }) {
  const token = cookies().get("erp_session")?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const bucket = url.searchParams.get("bucket") ?? "all";

  try {
    const upstream = await agentFetch(
      session,
      `/modules/${params.key}/list?bucket=${encodeURIComponent(bucket)}`,
    );
    const json = await upstream.json();
    return NextResponse.json(json, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { error: "Agent unreachable", rows: [] },
      { status: 502 },
    );
  }
}