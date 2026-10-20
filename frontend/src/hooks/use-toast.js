import * as React from "react";
import { getErrorMessage } from "@/lib/utils";
// Lets code outside React components (api helpers, module-level report loaders)
// raise the same popup: the provider registers its `toast` here while mounted.
let bridge = null;
let lastMessage = "";
let lastShownAt = 0;
/**
 * Shows a plain-language error popup for a caught failure. Identical messages
 * within 3 seconds are shown once, so several requests failing together (e.g.
 * offline) don't stack up popups.
 */
export function notifyError(e, title = "Something went wrong") {
  const description = getErrorMessage(e);
  const now = Date.now();
  if (description === lastMessage && now - lastShownAt < 3000) return;
  lastMessage = description;
  lastShownAt = now;
  bridge?.({ title, description, variant: "destructive" });
}
const ToastContext = React.createContext(undefined);
export function ToastProvider({ children }) {
  const [toasts, setToasts] = React.useState([]);
  const toast = React.useCallback((props) => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts((prev) => [...prev, { ...props, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);
  React.useEffect(() => {
    bridge = toast;
    return () => {
      if (bridge === toast) bridge = null;
    };
  }, [toast]);
  const dismiss = React.useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  return React.createElement(
    ToastContext.Provider,
    { value: { toasts, toast, dismiss } },
    children,
  );
}
export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
