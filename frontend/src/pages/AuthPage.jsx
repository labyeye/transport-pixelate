import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { errMsg } from "@/lib/errors";
import {
  AuthShell,
  authButton,
  authInput,
} from "@/components/common/AuthShell";
import { EMAIL_RE, Field, PasswordInput } from "@/components/common/AuthFields";

// Sign-in only. Creating an account lives on /register, then the onboarding wizard (same flow as NestHR).
export default function AuthPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({ email: "", password: "" });
  const [touched, setTouched] = useState({});
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  const errors = {};
  if (!EMAIL_RE.test(f.email.trim())) errors.email = "Enter a valid email address";
  if (!f.password) errors.password = "Password is required";
  const err = (k) => (touched[k] ? errors[k] : undefined);
  const touch = (k) => () => setTouched((t) => ({ ...t, [k]: true }));
  const set = (k) => (e) => {
    setF({ ...f, [k]: e.target.value });
    setError("");
  };
  const submit = async (e) => {
    e.preventDefault();
    if (Object.keys(errors).length) {
      setTouched({ email: true, password: true });
      return;
    }
    setBusy(true);
    try {
      await login(f.email.trim(), f.password);
      navigate("/");
    } catch (e2) {
      setError(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <div className="mb-8">
        <h2 className="text-2xl sm:text-3xl font-display font-bold text-black">Welcome back</h2>
        <p className="text-sm text-gray-500 mt-1 font-medium">Sign in to your workspace</p>
      </div>
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg bg-red-50 border-2 border-red-400 text-red-600 text-sm px-3 py-2.5 mb-5"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="font-medium">{error}</span>
        </div>
      )}
      <form onSubmit={submit} noValidate className="space-y-5">
        <Field label="Email" htmlFor="email" error={err("email")}>
          <input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            className={`${authInput} ${err("email") ? "!border-red-500" : ""}`}
            value={f.email}
            onChange={set("email")}
            onBlur={touch("email")}
            placeholder="Enter Email address"
          />
        </Field>
        <Field label="Password" htmlFor="password" error={err("password")}>
          <PasswordInput
            id="password"
            value={f.password}
            onChange={set("password")}
            onBlur={touch("password")}
            placeholder="Enter your Password"
            autoComplete="current-password"
            invalid={!!err("password")}
            show={showPw}
            onToggle={() => setShowPw(!showPw)}
          />
        </Field>
        <div className="flex justify-end -mt-2">
          <Link to="/forgot-password" className="text-xs font-bold text-[#024BAB] hover:underline">
            Forgot password?
          </Link>
        </div>
        <button type="submit" disabled={busy} className={authButton}>
          {busy ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Signing in…
            </>
          ) : (
            <>
              Sign In <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>
      <div className="mt-6 pt-6 border-t-2 border-black/10 text-center">
        <p className="text-xs text-gray-500">
          New to Nest Transport?{" "}
          <Link to="/register" className="font-bold text-[#024BAB] hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
