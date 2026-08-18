import { readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CORE_SOURCE_DIRECTORY = resolve(import.meta.dirname, "../src");
const ALLOWED_AUTH_IMPORT = "@openmeld/auth/organization-policy";
const AUTH_IMPORT_PATTERN =
  /(?:from\s+|import\s*(?:\(\s*)?)["'](@openmeld\/auth(?:\/[^"']*)?)["']/g;

describe("Core Auth package import boundary", () => {
  it("keeps Better Auth runtime configuration out of the Core Worker bundle", () => {
    const violations = listTypeScriptFiles(CORE_SOURCE_DIRECTORY).flatMap(
      (filePath) => {
        const source = readFileSync(filePath, "utf8");
        return [...source.matchAll(AUTH_IMPORT_PATTERN)]
          .map((match) => match[1])
          .filter((importPath) => importPath !== ALLOWED_AUTH_IMPORT)
          .map((importPath) => `${filePath} imports ${importPath}`);
      }
    );

    expect(violations).toEqual([]);
  });
});

function listTypeScriptFiles(directoryPath: string): string[] {
  return readdirSync(directoryPath, { withFileTypes: true }).flatMap(
    (entry) => {
      const childPath = join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return listTypeScriptFiles(childPath);
      }
      return entry.isFile() && [".ts", ".tsx"].includes(extname(entry.name))
        ? [childPath]
        : [];
    }
  );
}
