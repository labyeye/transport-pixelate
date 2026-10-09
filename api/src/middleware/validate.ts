import type { Request, RequestHandler } from "express";
import { ZodError, ZodTypeAny } from "zod";
import { badRequest } from "../utils/errors";

type Source = "body" | "query" | "params";

export const validate =
  (schema: ZodTypeAny, source: Source = "body"): RequestHandler =>
  (req: Request, _res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      return next(badRequest("Validation failed", formatZod(parsed.error)));
    }
    // Replace with the parsed (stripped + coerced) value.
    if (source === "query") Object.defineProperty(req, "query", { value: parsed.data, writable: true });
    else (req as any)[source] = parsed.data;
    next();
  };

const formatZod = (e: ZodError) => e.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
