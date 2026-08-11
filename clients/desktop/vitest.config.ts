import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Two projects: L1/L2 are pure node (.test.ts); L3 renderer components run in
// jsdom (.test.tsx) with the React plugin for JSX/Fast-Refresh transform.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["tests/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["tests/**/*.test.tsx"],
        },
      },
    ],
  },
});
