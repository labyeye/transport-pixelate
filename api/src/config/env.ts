import "dotenv/config";

const required = ["JWT_SECRET", "JWT_REFRESH_SECRET", "MONGO_URI"] as const;

export function loadEnv() {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
  if (process.env.NODE_ENV === "production" && !process.env.ALLOWED_ORIGINS) {
    throw new Error("ALLOWED_ORIGINS must be set in production");
  }
  return {
    port: Number(process.env.PORT ?? 5100),
    isProd: process.env.NODE_ENV === "production",
    mongoUri: process.env.MONGO_URI!,
    jwtSecret: process.env.JWT_SECRET!,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET!,
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "http://localhost:5175")
      .split(",")
      .map((s) => s.trim()),
  };
}
