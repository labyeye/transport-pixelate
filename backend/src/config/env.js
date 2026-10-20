import "dotenv/config";
const required = ["JWT_SECRET", "JWT_REFRESH_SECRET", "MONGO_URI"];
export function loadEnv() {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
  if (process.env.NODE_ENV === "production") {
    if (!process.env.ALLOWED_ORIGINS) {
      throw new Error("ALLOWED_ORIGINS must be set in production");
    }
    // Signing keys must be long, random and different from each other and from the documented placeholders.
    for (const k of ["JWT_SECRET", "JWT_REFRESH_SECRET"]) {
      const v = process.env[k];
      if (v.length < 32 || /change-?me|example|secret$/i.test(v)) {
        throw new Error(
          `${k} is too weak for production: use at least 32 random characters (e.g. openssl rand -hex 32)`,
        );
      }
    }
    if (process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
      throw new Error("JWT_SECRET and JWT_REFRESH_SECRET must be different");
    }
  }
  return {
    port: Number(process.env.PORT ?? 5100),
    isProd: process.env.NODE_ENV === "production",
    mongoUri: process.env.MONGO_URI,
    jwtSecret: process.env.JWT_SECRET,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "http://localhost:5175")
      .split(",")
      .map((s) => s.trim()),
  };
}
