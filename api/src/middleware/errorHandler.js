import { HttpError } from "../utils/errors.js";
export const errorHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    return res
      .status(err.status)
      .json({ success: false, message: err.message, errors: err.details });
  }
  // Mongo duplicate key
  if (err?.code === 11000) {
    return res
      .status(409)
      .json({
        success: false,
        message: "A record with these details already exists",
      });
  }
  if (err?.name === "CastError") {
    return res
      .status(400)
      .json({ success: false, message: "Invalid identifier" });
  }
  if (err?.name === "ValidationError") {
    return res
      .status(400)
      .json({
        success: false,
        message: "Validation failed",
        errors: Object.values(err.errors).map((e) => ({
          path: e.path,
          message: e.message,
        })),
      });
  }
  console.error("[unhandled]", err?.message);
  res.status(500).json({ success: false, message: "Something went wrong" });
};
