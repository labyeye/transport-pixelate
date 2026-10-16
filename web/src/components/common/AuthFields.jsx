import { Eye, EyeOff } from "lucide-react";
import { authLabel } from "@/components/common/AuthShell";

/** Label + control + inline error, shared by the sign-in, sign-up and onboarding forms. */
export function Field({ label, htmlFor, error, className = "", children }) {
  return (
    <div className={className}>
      <label className={authLabel} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error && (
        <p role="alert" className="mt-1 text-xs font-semibold text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function PasswordInput({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  autoComplete,
  invalid,
  show,
  onToggle,
}) {
  return (
    <div
      className={`flex rounded-lg overflow-hidden border-2 bg-white transition-colors ${invalid ? "border-red-500" : "border-black focus-within:border-[#024BAB]"}`}
    >
      <input
        id={id}
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        aria-invalid={invalid}
        className="flex-1 min-w-0 px-4 py-3 bg-white text-sm font-medium outline-none !border-0 !shadow-none"
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
      />
      <button
        type="button"
        aria-label={show ? "Hide password" : "Show password"}
        onClick={onToggle}
        className="px-3 border-l-2 border-black hover:bg-gray-50 transition-colors"
      >
        {show ? <EyeOff className="w-4 h-4 text-black" /> : <Eye className="w-4 h-4 text-black" />}
      </button>
    </div>
  );
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
