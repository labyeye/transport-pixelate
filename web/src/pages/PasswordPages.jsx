import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, CheckCircle2 } from "lucide-react";
import { post } from "@/services/api";
import { errMsg } from "@/lib/errors";
import { Field, inputCls } from "@/components/common/Field";
import { BrandMark } from "@/components/common/BrandMark";

function Shell({ title, children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm border-2 border-black bg-white p-6 space-y-4">
        <BrandMark />
        <h1 className="text-xl font-bold">{title}</h1>
        {children}
        <Link
          to="/login"
          className="flex items-center gap-1 text-sm font-semibold underline"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
        </Link>
      </div>
    </div>
  );
}
const Alert = ({ children }) => (
  <div
    role="alert"
    className="flex items-start gap-2 border-2 border-[#EF4444] bg-red-50 p-3 text-sm font-semibold text-red-700"
  >
    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {children}
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
        <div className="flex gap-2 text-sm font-semibold border-2 border-black bg-green-50 p-3">
          <CheckCircle2 className="w-4 h-4 text-green-700 shrink-0 mt-0.5" /> If
          that email has an account, a reset link is on its way. The link works
          for 60 minutes. If nothing arrives, ask your administrator for a reset
          link.
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Email" required>
            <input
              required
              type="email"
              autoComplete="email"
              className={inputCls}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <button
            disabled={busy}
            className="w-full border-2 border-black bg-[#024BAB] text-white py-2.5 font-bold disabled:opacity-60"
          >
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
        <div className="flex gap-2 text-sm font-semibold border-2 border-black bg-green-50 p-3">
          <CheckCircle2 className="w-4 h-4 text-green-700 shrink-0 mt-0.5" />{" "}
          Password saved. Taking you to sign in…
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field label="New password (min 8 characters)" required>
            <input
              required
              minLength={8}
              type="password"
              autoComplete="new-password"
              className={inputCls}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
          </Field>
          <Field label="Repeat password" required>
            <input
              required
              minLength={8}
              type="password"
              autoComplete="new-password"
              className={inputCls}
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
            />
          </Field>
          <button
            disabled={busy}
            className="w-full border-2 border-black bg-[#024BAB] text-white py-2.5 font-bold disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save password"}
          </button>
        </form>
      )}
    </Shell>
  );
}
