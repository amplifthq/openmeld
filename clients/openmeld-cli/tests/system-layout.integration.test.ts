import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSystemLayout } from "../src/config/system-layout";
import { withTempHome } from "./helpers/fs";

describe("system layout", () => {
  it("creates v1 layout file when missing", async () => {
    await withTempHome(async (home) => {
      const layout = await ensureSystemLayout();
      expect(layout.v).toBe(1);
      expect(layout.schema).toBe("openmeld-fs-v1");
      expect(typeof layout.createdAt).toBe("string");
      expect(typeof layout.updatedAt).toBe("string");

      const raw = await readFile(
        join(home, ".openmeld", "system", "layout.json"),
        "utf8"
      );
      const parsed = JSON.parse(raw);
      expect(parsed.v).toBe(1);
      expect(parsed.schema).toBe("openmeld-fs-v1");
    });
  });

  it("rewrites invalid layout payload to v1", async () => {
    await withTempHome(async (home) => {
      const path = join(home, ".openmeld", "system", "layout.json");
      await mkdir(join(home, ".openmeld", "system"), { recursive: true });
      await writeFile(path, `{"v":99,"schema":"legacy"}\n`, "utf8");

      const layout = await ensureSystemLayout();
      expect(layout.v).toBe(1);
      expect(layout.schema).toBe("openmeld-fs-v1");

      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw);
      expect(parsed.v).toBe(1);
      expect(parsed.schema).toBe("openmeld-fs-v1");
    });
  });

  it("rewrites layout when timestamps are invalid", async () => {
    await withTempHome(async (home) => {
      const path = join(home, ".openmeld", "system", "layout.json");
      await mkdir(join(home, ".openmeld", "system"), { recursive: true });
      await writeFile(
        path,
        `${JSON.stringify(
          {
            v: 1,
            schema: "openmeld-fs-v1",
            createdAt: "not-a-date",
            updatedAt: "still-not-a-date",
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const layout = await ensureSystemLayout();
      expect(Number.isNaN(Date.parse(layout.createdAt))).toBe(false);
      expect(Number.isNaN(Date.parse(layout.updatedAt))).toBe(false);

      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as {
        createdAt?: string;
        updatedAt?: string;
      };
      expect(parsed.createdAt).not.toBe("not-a-date");
      expect(parsed.updatedAt).not.toBe("still-not-a-date");
    });
  });

  it("rewrites layout when timestamp is ISO-shaped but calendar-invalid", async () => {
    await withTempHome(async (home) => {
      const path = join(home, ".openmeld", "system", "layout.json");
      await mkdir(join(home, ".openmeld", "system"), { recursive: true });
      await writeFile(
        path,
        `${JSON.stringify(
          {
            v: 1,
            schema: "openmeld-fs-v1",
            createdAt: "2024-02-30T00:00:00.000Z",
            updatedAt: "2024-02-30T00:00:00.000Z",
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const layout = await ensureSystemLayout();
      expect(layout.createdAt).not.toBe("2024-02-30T00:00:00.000Z");
      expect(layout.updatedAt).not.toBe("2024-02-30T00:00:00.000Z");
    });
  });

  it("uses one canonical layout when initialized concurrently", async () => {
    await withTempHome(async (home) => {
      const layouts = await Promise.all(
        Array.from({ length: 12 }, () => ensureSystemLayout())
      );

      const createdAtValues = new Set(
        layouts.map((layout) => layout.createdAt)
      );
      const updatedAtValues = new Set(
        layouts.map((layout) => layout.updatedAt)
      );
      expect(createdAtValues.size).toBe(1);
      expect(updatedAtValues.size).toBe(1);

      const raw = await readFile(
        join(home, ".openmeld", "system", "layout.json"),
        "utf8"
      );
      const stored = JSON.parse(raw) as {
        createdAt?: string;
        updatedAt?: string;
      };
      expect(createdAtValues.has(String(stored.createdAt ?? ""))).toBe(true);
      expect(updatedAtValues.has(String(stored.updatedAt ?? ""))).toBe(true);
    });
  });

  it("rethrows non-ENOENT read errors", async () => {
    await withTempHome(async (home) => {
      const path = join(home, ".openmeld", "system", "layout.json");
      await mkdir(join(home, ".openmeld", "system"), { recursive: true });
      await writeFile(
        path,
        JSON.stringify({
          v: 1,
          schema: "openmeld-fs-v1",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
        "utf8"
      );
      await chmod(path, 0o222);

      try {
        await expect(ensureSystemLayout()).rejects.toSatisfy((error) => {
          const code =
            error && typeof error === "object" && "code" in error
              ? (error as { code?: unknown }).code
              : undefined;
          return code === "EACCES" || code === "EPERM";
        });
      } finally {
        await chmod(path, 0o644);
      }
    });
  });
});
