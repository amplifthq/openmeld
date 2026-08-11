import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Process-heavy contract tests can produce large bursts of slow-test detail
    // under affected-test CI contention. Keep CI output compact while
    // preserving Vitest's default local diagnostics.
    reporters: process.env.CI ? ["dot"] : ["default"],
  },
});
