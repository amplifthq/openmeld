import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTempHome } from "./helpers/fs";

vi.mock("../src/openmeld", () => {
  throw new Error("Business startup is broken");
});

describe("independent maintenance entry", () => {
  afterEach(() => vi.resetModules());

  it("can start without loading business commands or rewriting a newer layout", async () => {
    await withTempHome(async (home) => {
      const path = join(home, ".openmeld", "system", "layout.json");
      await mkdir(join(home, ".openmeld", "system"), { recursive: true });
      const saved = '{"v":2,"schema":"openmeld-fs-v2","futureData":"keep"}';
      await writeFile(path, saved);
      const previousArgv = process.argv;
      const previousExitCode = process.exitCode;
      try {
        process.argv = [
          process.execPath,
          "openmeld",
          "service",
          "update-worker",
        ];
        process.exitCode = undefined;
        await import("../src/openmeld-entry");
        expect(process.exitCode).toBeUndefined();
        expect(await readFile(path, "utf8")).toBe(saved);
      } finally {
        process.argv = previousArgv;
        process.exitCode = previousExitCode;
      }
    });
  });
});
