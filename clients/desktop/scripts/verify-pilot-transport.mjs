import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import electron from "electron";
import { build } from "vite";

const output = await mkdtemp(join(tmpdir(), "openmeld-transport-check-"));
try {
  await build({
    configFile: false,
    logLevel: "error",
    ssr: { noExternal: true },
    build: {
      ssr: resolve(import.meta.dirname, "../tests/pilot-transport.electron.ts"),
      outDir: output,
      minify: false,
      rollupOptions: {
        external: ["electron", /^node:/u],
        output: { entryFileNames: "check.mjs" },
      },
    },
  });
  process.exitCode = await new Promise((resolveExit, reject) => {
    const child = spawn(electron, [join(output, "check.mjs"), output], {
      stdio: "inherit",
      env: { ...process.env, OPENMELD_HOME: join(output, "home") },
    });
    child.on("error", reject);
    child.on("exit", (code) => resolveExit(code ?? 1));
  });
} finally {
  await rm(output, { recursive: true, force: true });
}
