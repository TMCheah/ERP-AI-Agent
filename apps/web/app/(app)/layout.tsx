import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyToken } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const token = cookies().get("erp_session")?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session) redirect("/login");

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <aside className="w-1/5 min-w-[220px] max-w-[300px] border-r border-ink-800 bg-ink-900/50">
        <Sidebar session={session} />
      </aside>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}