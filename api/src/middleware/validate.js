import { badRequest } from "../utils/errors.js";
export const validate =
  (schema, source = "body") =>
  (req, _res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      return next(badRequest("Validation failed", formatZod(parsed.error)));
    }
    // Replace with the parsed (stripped + coerced) value.
    if (source === "query")
      Object.defineProperty(req, "query", {
        value: parsed.data,
        writable: true,
      });
    else req[source] = parsed.data;
    next();
  };
const formatZod = (e) =>
  e.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
