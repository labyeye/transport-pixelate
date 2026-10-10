import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { errMsg } from "@/lib/errors";
import {
  AuthShell,
  authButton,
  authInput,
  authLabel,
} from "@/components/common/AuthShell";

export default function AuthPage() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [f, setF] = useState({
    organizationName: "",
    category: "school",
    name: "",
    email: "",
    password: "",
  });
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  const set = (k) => (e) => {
    setF({ ...f, [k]: e.target.value });
    setError("");
  };
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") await login(f.email, f.password);
      else await register(f);
      navigate("/");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  const register_ = mode === "register";

  return (
    <AuthShell>
      <div className="mb-8">
        <h2 className="text-2xl sm:text-3xl font-display font-bold text-black">
          {register_ ? "Create your organization" : "Welcome back"}
        </h2>
        <p className="text-sm text-gray-500 mt-1 font-medium">
          {register_
            ? "Set up Nest Transport for your fleet"
            : "Sign in to your workspace"}
        </p>
      </div>
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 bg-red-50 border-2 border-red-400 text-red-600 text-sm px-3 py-2.5 mb-5"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="font-medium">{error}</span>
        </div>
      )}
      <form onSubmit={submit} className="space-y-5">
        {register_ && (
          <>
            <div>
              <label className={authLabel} htmlFor="org">
                Organization name
              </label>
              <input
                id="org"
                required
                className={authInput}
                value={f.organizationName}
                onChange={set("organizationName")}
                placeholder="e.g. Greenfield Public School"
              />
            </div>
            <div>
              <label className={authLabel} htmlFor="cat">
                Type
              </label>
              <select
                id="cat"
                className={authInput}
                value={f.category}
                onChange={set("category")}
              >
                <option value="school">School</option>
                <option value="employee">Employee transport</option>
                <option value="institution">Institution</option>
                <option value="contractor">Transport contractor</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className={authLabel} htmlFor="name">
                Your name
              </label>
              <input
                id="name"
                required
                className={authInput}
                value={f.name}
                onChange={set("name")}
              />
            </div>
          </>
        )}
        <div>
          <label className={authLabel} htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            className={authInput}
            value={f.email}
            onChange={set("email")}
            placeholder="Enter your Email address"
          />
        </div>
        <div>
          <label className={authLabel} htmlFor="password">
            Password
          </label>
          <div className="flex border-2 border-black focus-within:border-[#024BAB] transition-colors">
            <input
              id="password"
              type={showPw ? "text" : "password"}
              required
              minLength={register_ ? 8 : 1}
              autoComplete={register_ ? "new-password" : "current-password"}
              className="flex-1 px-4 py-3 bg-white text-sm font-medium outline-none"
              value={f.password}
              onChange={set("password")}
              placeholder="Enter your Password"
            />
            <button
              type="button"
              aria-label={showPw ? "Hide password" : "Show password"}
              onClick={() => setShowPw(!showPw)}
              className="px-3 border-l-2 border-black hover:bg-gray-50 transition-colors"
            >
              {showPw ? (
                <EyeOff className="w-4 h-4 text-black" />
              ) : (
                <Eye className="w-4 h-4 text-black" />
              )}
            </button>
          </div>
        </div>
        {mode === "login" && (
          <div className="flex justify-end">
            <Link
              to="/forgot-password"
              className="text-xs font-bold text-[#024BAB] hover:underline"
            >
              Forgot password?
            </Link>
          </div>
        )}
        <button type="submit" disabled={busy} className={authButton}>
          {busy ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />{" "}
              {register_ ? "Creating…" : "Signing in…"}
            </>
          ) : (
            <>
              {register_ ? "Create account" : "Sign In"}{" "}
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>
      <div className="mt-6 pt-6 border-t-2 border-black/10 text-center">
        <p className="text-xs text-gray-500">
          {register_ ? "Already have an account? " : "New to Nest Transport? "}
          <button
            type="button"
            onClick={() => {
              setMode(register_ ? "login" : "register");
              setError("");
            }}
            className="font-bold text-[#024BAB] hover:underline"
          >
            {register_ ? "Sign in" : "Create an account"}
          </button>
        </p>
      </div>
    </AuthShell>
  );
}
