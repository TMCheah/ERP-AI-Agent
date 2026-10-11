"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MODULES } from "@/lib/modules";
import type { Session } from "@/lib/auth";

export default function Sidebar({ session }: { session: Session }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-ink-800 px-4 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            E
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-100">
              {process.env.NEXT_PUBLIC_APP_NAME ?? "Acme ERP"}
            </p>
            <p className="truncate text-[11px] text-slate-500">Natural-language</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {MODULES.map((m) => {
          const isActive = pathname.startsWith(m.href.split("?")[0]);
          const hideForStaff = m.key === "settings" && session.role !== "ADMIN";
          if (hideForStaff) return null;
          return (
            <Link
              key={m.key}
              href={m.href}
              className={
                "mb-0.5 flex items-center gap-3 rounded-md px-3 py-2 text-sm transition " +
                (isActive
                  ? "bg-brand-600/15 text-brand-500"
                  : "text-slate-400 hover:bg-ink-800 hover:text-slate-200")
              }
            >
              <span className="w-4 text-center text-base leading-none">{m.icon}</span>
              <span className="truncate">{m.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-ink-800 p-3">
        <div className="mb-2 flex items-center gap-2.5 rounded-md px-2 py-1.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-700 text-xs font-semibold text-slate-300">
            {session.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-slate-200">{session.name}</p>
            <p className="truncate text-[10px] text-slate-500">{session.role}</p>
          </div>
        </div>
        <button className="btn btn-ghost w-full justify-start text-xs" onClick={logout}>
          Sign out
        </button>
      </div>
    </div>
  );
}