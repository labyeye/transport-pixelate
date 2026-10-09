import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight, MapPin, Route, Truck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { errMsg } from "@/lib/errors";
import { Field, inputCls } from "@/components/common/Field";
import { BrandMark } from "@/components/common/BrandMark";

export default function AuthPage() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [f, setF] = useState({
    organizationName: "",
    category: "school",
    name: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  const set =
    (k: keyof typeof f) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
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

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <div className="hidden lg:flex flex-col justify-between bg-[#024BAB] border-r-2 border-black p-10 text-white">
        <div className="bg-white inline-block self-start p-2 border-2 border-black">
          <BrandMark />
        </div>
        <div>
          <h1 className="text-4xl font-bold mb-4">
            Run your fleet from one place.
          </h1>
          <ul className="space-y-3 font-semibold">
            <li className="flex gap-2">
              <Truck className="w-5 h-5" /> Vehicles, drivers and documents
            </li>
            <li className="flex gap-2">
              <Route className="w-5 h-5" /> Routes, stops and trip dispatch
            </li>
            <li className="flex gap-2">
              <MapPin className="w-5 h-5" /> Live tracking with honest freshness
            </li>
          </ul>
        </div>
        <p className="text-sm opacity-80">Part of the Nest product family.</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form
          onSubmit={submit}
          className="w-full max-w-sm border-2 border-black bg-white p-6 space-y-4"
        >
          <h2 className="text-2xl font-bold">
            {mode === "login" ? "Sign in" : "Create your organization"}
          </h2>
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 border-2 border-[#EF4444] bg-red-50 p-3 text-sm font-semibold text-red-700"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}
          {mode === "register" && (
            <>
              <Field label="Organization name" required>
                <input
                  required
                  className={inputCls}
                  value={f.organizationName}
                  onChange={set("organizationName")}
                />
              </Field>
              <Field label="Type">
                <select
                  className={inputCls}
                  value={f.category}
                  onChange={set("category")}
                >
                  <option value="school">School</option>
                  <option value="employee">Employee transport</option>
                  <option value="institution">Institution</option>
                  <option value="contractor">Transport contractor</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Your name" required>
                <input
                  required
                  className={inputCls}
                  value={f.name}
                  onChange={set("name")}
                />
              </Field>
            </>
          )}
          <Field label="Email" required>
            <input
              required
              type="email"
              className={inputCls}
              value={f.email}
              onChange={set("email")}
              autoComplete="email"
            />
          </Field>
          <Field label="Password" required>
            <input
              required
              type="password"
              minLength={mode === "register" ? 8 : 1}
              className={inputCls}
              value={f.password}
              onChange={set("password")}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
            />
          </Field>
          <button
            disabled={busy}
            className="w-full border-2 border-black bg-[#024BAB] text-white py-2.5 font-bold flex items-center justify-center gap-2 hover:bg-[#01368A] disabled:opacity-60"
          >
            {busy
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}{" "}
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError("");
            }}
            className="text-sm font-semibold underline"
          >
            {mode === "login"
              ? "New here? Create an organization"
              : "Already have an account? Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
