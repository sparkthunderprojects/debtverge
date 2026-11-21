import { useState, type FormEvent } from "react";
import { RefreshCw, Mail, Lock, User as UserIcon, ArrowRight, AlertCircle, Download, FileArchive, FileText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Spinner } from "@/components/ui";

export function Login() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setLoading(true);

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: fullName.trim() || undefined } },
      });
      setLoading(false);
      if (error) {
        setError(error.message);
        return;
      }
      if (data.session) {
        // signed in immediately
        return;
      }
      setInfo("Account created. You can now sign in.");
      setMode("signin");
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      setLoading(false);
      if (error) {
        setError(error.message);
      }
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-blue-50 to-slate-100 p-4">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl lg:grid-cols-2">
        {/* Brand panel */}
        <div className="relative hidden flex-col justify-between bg-gradient-to-br from-blue-700 via-blue-600 to-blue-800 p-10 text-white lg:flex">
          <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 20% 20%, white 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
          <div className="relative">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
                <RefreshCw className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-lg font-bold">Sales Command Center</h1>
                <p className="text-xs text-blue-100">WooCommerce multi-brand analytics</p>
              </div>
            </div>
          </div>
          <div className="relative space-y-5">
            <h2 className="text-2xl font-bold leading-tight">
              Unified sales intelligence across every store you run.
            </h2>
            <ul className="space-y-3 text-sm text-blue-50">
              {[
                "Real-time revenue, orders & AOV across all brands",
                "Multi-store inventory with low-stock alerts",
                "Webhook diagnostics with retry & audit logs",
                "Customer 360 — LTV, cross-brand behavior & loyalty",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-white" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <p className="relative text-xs text-blue-200">Powered by Supabase · Edge Functions</p>
        </div>

        {/* Form panel */}
        <div className="flex flex-col justify-center p-8 sm:p-12">
          <div className="mx-auto w-full max-w-sm">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
                <RefreshCw className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-base font-bold text-slate-900">Sales Command Center</h1>
                <p className="text-xs text-slate-500">WooCommerce analytics</p>
              </div>
            </div>

            <h2 className="text-2xl font-bold tracking-tight text-slate-900">
              {mode === "signin" ? "Sign in to DebtVerge" : "Create your account"}
            </h2>
            <p className="mt-1.5 text-sm text-slate-500">
              {mode === "signin"
                ? "Debt management software for modern DMP providers."
                : "Set up your operator account to get started."}
            </p>

            <form onSubmit={submit} className="mt-8 space-y-4">
              {mode === "signup" && (
                <Field
                  label="Full name"
                  icon={<UserIcon className="h-4 w-4 text-slate-400" />}
                  value={fullName}
                  onChange={setFullName}
                  placeholder="Jane Operator"
                  autoComplete="name"
                />
              )}
              <Field
                label="Email"
                icon={<Mail className="h-4 w-4 text-slate-400" />}
                value={email}
                onChange={setEmail}
                placeholder="you@company.com"
                type="email"
                autoComplete="email"
              />
              <Field
                label="Password"
                icon={<Lock className="h-4 w-4 text-slate-400" />}
                value={password}
                onChange={setPassword}
                placeholder="••••••••"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
              />

              {error && (
                <div className="flex items-start gap-2 rounded-lg bg-danger-50 px-3 py-2.5 text-sm text-danger-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              {info && (
                <div className="rounded-lg bg-success-50 px-3 py-2.5 text-sm text-success-700">
                  {info}
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
                {loading ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <>
                    {mode === "signin" ? "Sign in" : "Create account"}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-slate-500">
              {mode === "signin" ? "Don't have an account?" : "Already have an account?"}{" "}
              <button
                onClick={() => {
                  setMode(mode === "signin" ? "signup" : "signin");
                  setError(null);
                  setInfo(null);
                }}
                className="font-semibold text-blue-600 hover:text-blue-700"
              >
                {mode === "signin" ? "Sign up" : "Sign in"}
              </button>
            </p>
          </div>

          {/* DebtVerge Standalone Documents — Download Panel */}
          <div className="mx-auto mt-10 w-full max-w-sm rounded-2xl border-2 border-blue-500 bg-blue-50 p-5">
            <h3 className="text-sm font-bold text-slate-900">DebtVerge Standalone Documents</h3>
            <p className="mt-1 text-xs text-slate-600">Click any link below to download the files to your computer.</p>
            <div className="mt-4 space-y-2.5">
              <a
                href="/DEBTVERGE_STANDALONE_DOCUMENTS.zip"
                download
                className="flex items-center gap-3 rounded-lg bg-green-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-green-700"
              >
                <FileArchive className="h-5 w-5 shrink-0" />
                <span>Download ZIP (both files)</span>
                <Download className="ml-auto h-4 w-4" />
              </a>
              <a
                href="/DEBTVERGE_STANDALONE_SPECIFICATION.md"
                download
                className="flex items-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-medium text-slate-700 transition hover:border-blue-400 hover:bg-blue-50"
              >
                <FileText className="h-4 w-4 shrink-0 text-blue-600" />
                <span>Specification (1,688 lines)</span>
                <Download className="ml-auto h-3.5 w-3.5" />
              </a>
              <a
                href="/DEBTVERGE_STANDALONE_ARCHITECTURE.md"
                download
                className="flex items-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-medium text-slate-700 transition hover:border-blue-400 hover:bg-blue-50"
              >
                <FileText className="h-4 w-4 shrink-0 text-blue-600" />
                <span>Architecture (2,307 lines)</span>
                <Download className="ml-auto h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  icon,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">{icon}</span>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="input pl-10"
        />
      </div>
    </div>
  );
}
