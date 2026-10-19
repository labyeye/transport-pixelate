import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { AlertCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { errMsg } from "@/lib/errors";
import { AuthShell, authInput, authButton } from "@/components/common/AuthShell";
import { EMAIL_RE, Field, PasswordInput } from "@/components/common/AuthFields";

// Same sign-up as NestHR: just name, email and password. Company details, fleet size and plan
// are collected next on /onboarding.
export default function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [touched, setTouched] = useState({});
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  const errors = {};
  const name = f.name.trim();
  if (name.length < 2) errors.name = "Enter at least 2 characters";
  else if (name.length > 100) errors.name = "Keep it under 100 characters";
  if (!EMAIL_RE.test(f.email.trim())) errors.email = "Enter a valid email address";
  if (f.password.length < 8) errors.password = "Use at least 8 characters";
  else if (f.password.length > 128) errors.password = "Keep it under 128 characters";
  else if (!/[A-Za-z]/.test(f.password) || !/\d/.test(f.password))
    errors.password = "Include at least one letter and one number";
  const err = (k) => (touched[k] ? errors[k] : undefined);
  const touch = (k) => () => setTouched((t) => ({ ...t, [k]: true }));
  const set = (k) => (e) => {
    setF({ ...f, [k]: e.target.value });
    setError("");
  };
  const bad = (k) => (err(k) ? "!border-red-500" : "");

  const submit = async (e) => {
    e.preventDefault();
    if (Object.keys(errors).length) {
      setTouched({ name: true, email: true, password: true });
      return;
    }
    setBusy(true);
    try {
      await register({ name, email: f.email.trim(), password: f.password });
      navigate("/onboarding");
    } catch (e2) {
      setError(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
        <h2 className="font-display font-bold text-3xl text-black mb-1">Create account</h2>
        <p className="text-gray-500 text-sm mb-8">
          Set up your transport workspace ·{" "}
          <Link to="/login" className="font-bold text-black underline hover:text-[#FA731C] transition-colors">
            Sign in
          </Link>
        </p>
        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg bg-[#EF4444]/10 border-2 border-[#EF4444] text-[#EF4444] text-sm px-3 py-2.5 mb-5"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="font-medium">{error}</span>
          </div>
        )}
        <form onSubmit={submit} noValidate className="space-y-5 login-anim">
          <Field label="Full Name" htmlFor="name" error={err("name")}>
            <input
              id="name"
              autoFocus
              autoComplete="name"
              className={`${authInput} ${bad("name")}`}
              value={f.name}
              onChange={set("name")}
              onBlur={touch("name")}
              placeholder="John Smith"
              maxLength={100}
            />
          </Field>
          <Field label="Email" htmlFor="email" error={err("email")}>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className={`${authInput} ${bad("email")}`}
              value={f.email}
              onChange={set("email")}
              onBlur={touch("email")}
              placeholder="you@company.com"
            />
          </Field>
          <Field label="Password" htmlFor="password" error={err("password")}>
            <PasswordInput
              id="password"
              value={f.password}
              onChange={set("password")}
              onBlur={touch("password")}
              placeholder="Min. 8 characters"
              autoComplete="new-password"
              invalid={!!err("password")}
              show={showPw}
              onToggle={() => setShowPw(!showPw)}
            />
          </Field>
          <button
            type="submit"
            disabled={busy}
            className={authButton}
          >
            {busy ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Creating account...
              </span>
            ) : (
              "Create Account →"
            )}
          </button>
        </form>
    </AuthShell>
  );
}
