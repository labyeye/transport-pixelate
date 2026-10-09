import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", testTimeout: 60000, hookTimeout: 120000, env: { NODE_ENV: "test", JWT_SECRET: "test-secret-test-secret", JWT_REFRESH_SECRET: "test-refresh-secret-test" } } });
