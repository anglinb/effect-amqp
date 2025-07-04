import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./tests/setup/global.ts"],
    testTimeout: 30000,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/setup/**"],
    reporters: ["default"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    },
  },
});