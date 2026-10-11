import { SignJWT, jwtVerify } from "jose";

const secret = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "dev-insecure-secret-change-me",
);

export type Session = {
  userId: string;
  tenantId: string;
  email: string;
  name: string;
  role: "ADMIN" | "APPROVER" | "STAFF";
};

export async function signToken(session: Session): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifyToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return {
      userId: payload.userId as string,
      tenantId: payload.tenantId as string,
      email: payload.email as string,
      name: payload.name as string,
      role: payload.role as Session["role"],
    };
  } catch {
    return null;
  }
}