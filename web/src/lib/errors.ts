import { ApiError } from "@/services/api";

export function errMsg(e: unknown) {
  if (e instanceof ApiError) {
    const first = e.errors?.[0];
    return first ? `${first.path ? first.path + ": " : ""}${first.message}` : e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong";
}
