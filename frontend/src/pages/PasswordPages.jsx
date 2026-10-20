import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, CheckCircle2 } from "lucide-react";
import { post } from "@/services/api";
import { errMsg } from "@/lib/errors";
import {
  AuthShell,
  authButton,
  authInput,
  authLabel,
} from "@/components/common/AuthShell";

function Shell({ title, children }) {
  return (
    <AuthShell>
      <div className="mb-8">
        <h2 className="text-2xl sm:text-3xl font-display font-bold text-black">
          {title}
        </h2>
      </div>
      <div className="space-y-5 login-anim">
        {children}
        <Link
          to="/login"
          className="flex items-center gap-1 text-xs font-bold text-[#024BAB] hover:underline"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
        </Link>
      </div>
    </AuthShell>
  );
}

const Alert = ({ children }) => (
  <div
    role="alert"
    className="flex items-center gap-2 bg-red-50 border-2 border-red-400 text-red-600 text-sm px-3 py-2.5"
  >
    <AlertCircle className="w-4 h-4 shrink-0" />
    <span className="font-medium">{children}</span>
  </div>
);
const Done = ({ children }) => (
  <div className="flex gap-2 text-sm font-semibold border-2 border-black bg-green-50 p-3">
    <CheckCircle2 className="w-4 h-4 text-green-700 shrink-0 mt-0.5" />{" "}
    <span>{children}</span>
  </div>
);

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await post("/auth/forgot-password", { email });
      setDone(true);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="Reset your password">
      {done ? (
        <Done>
          If that email has an account, a reset link is on its way. It works for
          60 minutes. If nothing arrives, ask your administrator for a reset
          link.
        </Done>
      ) : (
        <form onSubmit={submit} className="space-y-5 login-anim">
          {error && <Alert>{error}</Alert>}
          <div>
            <label className={authLabel} htmlFor="fp-email">
              Email
            </label>
            <input
              id="fp-email"
              required
              type="email"
              autoComplete="email"
              autoFocus
              className={authInput}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter Email address"
            />
          </div>
          <button disabled={busy} className={authButton}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
    </Shell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (pw !== pw2) return setError("The two passwords don't match");
    setError("");
    setBusy(true);
    try {
      await post("/auth/reset-password", { token, password: pw });
      setDone(true);
      setTimeout(() => navigate("/login"), 2500);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  if (!token)
    return (
      <Shell title="Reset link missing">
        <Alert>
          This link is incomplete. Open the full link from your email, or
          request a new one.
        </Alert>
      </Shell>
    );
  return (
    <Shell title="Choose a new password">
      {done ? (
        <Done>Password saved. Taking you to sign in…</Done>
      ) : (
        <form onSubmit={submit} className="space-y-5 login-anim">
          {error && <Alert>{error}</Alert>}
          <div>
            <label className={authLabel} htmlFor="np1">
              New password (min 8 characters)
            </label>
            <input
              id="np1"
              required
              minLength={8}
              type="password"
              autoComplete="new-password"
              autoFocus
              className={authInput}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
          </div>
          <div>
            <label className={authLabel} htmlFor="np2">
              Repeat password
            </label>
            <input
              id="np2"
              required
              minLength={8}
              type="password"
              autoComplete="new-password"
              className={authInput}
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
            />
          </div>
          <button disabled={busy} className={authButton}>
            {busy ? "Saving…" : "Save password"}
          </button>
        </form>
      )}
    </Shell>
  );
}
