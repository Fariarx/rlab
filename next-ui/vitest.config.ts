import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    exclude: ["**/node_modules/**", "**/dist/**", "**/tests/e2e/**"],
    globals: true,
    setupFiles: "./vitest.setup.ts",
    // Streaming/integration specs chain several `waitFor`s, each allowed up to the
    // 5s `asyncUtilTimeout` (see vitest.setup.ts). The 5s vitest default would let
    // one slow assertion exhaust the whole test budget under full-suite load, so
    // give each test more headroom to stay deterministic.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
