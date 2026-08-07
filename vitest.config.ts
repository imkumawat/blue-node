import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    // Backend-only repo — nothing here touches the DOM, so don't pay jsdom's
    // startup cost on every run.
    environment: "node",

    // Kept in sync with the test override in eslint.config.js (*.test.ts /
    // *.spec.ts / tests/**) so a file that lints as a test also runs as one.
    include: ["src/**/*.{test,spec}.ts", "tests/**/*.{test,spec}.ts"],
    exclude: ["node_modules/**", "dist/**", "build/**"],

    // Explicit imports (`import { describe, it, expect } from "vitest"`) rather
    // than globals: enabling globals would also mean adding "vitest/globals" to
    // tsconfig types, and tsconfig is currently scoped to src/** for the build.
    globals: false,

    // A vi.spyOn left in place leaks into the next test and the failure surfaces
    // somewhere unrelated. Reset between tests instead of trusting cleanup.
    clearMocks: true,
    restoreMocks: true,
  },

  resolve: {
    alias: {
      // tsconfig declares "@/*" -> "./src/*". Nothing imports that way today,
      // but Vite doesn't read tsconfig paths, so without this the first "@/..."
      // import someone writes would resolve fine for tsc and fail under vitest.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
