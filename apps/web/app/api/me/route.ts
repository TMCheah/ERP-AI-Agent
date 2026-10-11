import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const token = cookies().get("erp_session")?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ session });
}