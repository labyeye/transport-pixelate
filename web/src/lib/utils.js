import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
/** Whole-rupee INR amount, e.g. ₹12,500. Missing values render as ₹0. */
export function formatCurrency(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount || 0);
}
export function formatDate(date) {
  return new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
/** Like formatDate, but returns "—" for a missing value. */
export function formatDateOrDash(date) {
  return date ? formatDate(date) : "—";
}
export function getInitials(name) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
/** Best-effort message from a caught value (Error, API error object or anything else). */
export function getErrorMessage(e, fallback = "Something went wrong") {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "object" && e !== null && "message" in e) {
    const m = e.message;
    if (typeof m === "string" && m) return m;
  }
  return typeof e === "string" && e ? e : fallback;
}
