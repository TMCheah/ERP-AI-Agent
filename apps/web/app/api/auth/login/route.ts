import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { signToken } from "@/lib/auth";

export const runtime = "nodejs";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) return NextResponse.json({ error: "Missing credentials" }, { status: 400 });

  const { rows } = await pool.query(
    `SELECT id, tenant_id, email, full_name, role, password_hash
       FROM users WHERE email = $1 LIMIT 1`,
    [email],
  );
  const user = rows[0];
  if (!user) return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });

  const token = await signToken({
    userId: user.id,
    tenantId: user.tenant_id,
    email: user.email,
    name: user.full_name,
    role: user.role,
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set("erp_session", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}