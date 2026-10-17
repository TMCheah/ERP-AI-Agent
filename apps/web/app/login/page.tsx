"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/chat";
  const [email, setEmail] = useState("admin@magent.test");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Login failed");
      setLoading(false);
      return;
    }
    
    // Keep loading=true so the overlay stays visible during Next.js routing
    router.push(next);
    router.refresh();
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-ink-950 px-4">
      
      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-ink-950/80 backdrop-blur-sm transition-opacity">
          <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-ink-700 border-t-brand-500"></div>
          <p className="text-sm font-medium text-slate-300">Signing in…</p>
        </div>
      )}

      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-xl font-bold text-white">
            E
          </div>
          <h1 className="text-xl font-semibold text-slate-100">
            {process.env.NEXT_PUBLIC_APP_NAME ?? "Magent ERP"}
          </h1>
          <p className="mt-1 text-sm text-slate-400">Sign in to continue</p>
        </div>
        <form onSubmit={submit} className="card p-6">
          <div className="mb-4">
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
              autoFocus
            />
          </div>
          <div className="mb-5">
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
          </div>
          {error && (
            <div className="mb-4 rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}
          <button className="btn btn-primary w-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
          <p className="mt-4 text-center text-xs text-slate-500">
            Demo: admin@magent.test / password123
          </p>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}