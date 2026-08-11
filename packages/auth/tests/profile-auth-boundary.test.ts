import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PROFILE_DOMAIN_DIR = new URL("../src/profiles/", import.meta.url);
const REPO_ROOT_DIR = new URL("../../../", import.meta.url);
const AUTH_WORKER_PROFILE_ADAPTER_DIR = new URL(
  "../../../services/auth/src/lib/profiles/",
  import.meta.url
);
const AUTH_WORKER_RPC_DIR = new URL(
  "../../../services/auth/src/lib/rpc/",
  import.meta.url
);

const FORBIDDEN_AUTH_BOUNDARY_PATTERNS = [
  /\bfrom\s+["'][^"']*better-auth[^"']*["']/,
  /\bfrom\s+["']\.\.\/db\/auth\.schema["']/,
  /\bfrom\s+["']\.\.\/db\/schema["']/,
  /\bfrom\s+["'][^"']*\/better-auth\/[^"']*["']/,
] as const;

const FORBIDDEN_DIRECT_PROFILE_STORAGE_PATTERNS = [
  /\bfrom\s+["']@openmeld\/db(?:\/[^"']*)?["']/,
  /\bfrom\s+["']\.\.\/db\/openmeld-profile\.schema["']/,
  /\bfrom\s+["']\.\.\/db\/profile-space-history\.schema["']/,
  /\bfrom\s+["']\.\.\/db\/schema["']/,
  /\bOPENMELD_RUNTIME_DB\b/,
] as const;

describe("profile auth boundary", () => {
  it("keeps product profile logic out of Better Auth-owned schema and runtime modules", () => {
    const violations = listTypeScriptFiles(PROFILE_DOMAIN_DIR).flatMap(
      (filePath) => {
        const source = readFileSync(filePath, "utf8");
        return FORBIDDEN_AUTH_BOUNDARY_PATTERNS.flatMap((pattern) =>
          pattern.test(source)
            ? [`${relative(process.cwd(), filePath)} matches ${pattern.source}`]
            : []
        );
      }
    );

    expect(violations).toEqual([]);
  });

  it("keeps Better Auth-owned schema free of OpenMeld profile product fields", () => {
    const authSchemaFiles = [
      "packages/db/src/auth/auth.schema.ts",
      "packages/auth/src/db/auth.schema.ts",
    ];

    const forbiddenTerms = [
      "openMeldProfiles",
      "openmeld_profiles",
      "profileKind",
      "profileHandle",
      "agentControllerRef",
      "controllerEnabled",
    ];

    const violations = authSchemaFiles.flatMap((relativePath) => {
      const source = readFileSync(new URL(relativePath, REPO_ROOT_DIR), "utf8");
      return forbiddenTerms.flatMap((term) =>
        source.includes(term) ? [`${relativePath} contains ${term}`] : []
      );
    });

    expect(violations).toEqual([]);
  });

  it("keeps auth worker profile adapters out of Better Auth runtime modules", () => {
    const violations = listTypeScriptFiles(
      AUTH_WORKER_PROFILE_ADAPTER_DIR
    ).flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return FORBIDDEN_AUTH_BOUNDARY_PATTERNS.flatMap((pattern) =>
        pattern.test(source)
          ? [`${relative(process.cwd(), filePath)} matches ${pattern.source}`]
          : []
      );
    });

    expect(violations).toEqual([]);
  });

  it("keeps Profile RPC and helpers from directly owning Profile or Binding storage writes", () => {
    const violations = listTypeScriptFiles(AUTH_WORKER_RPC_DIR).flatMap(
      (filePath) => {
        const source = readFileSync(filePath, "utf8");
        return FORBIDDEN_DIRECT_PROFILE_STORAGE_PATTERNS.flatMap((pattern) =>
          pattern.test(source)
            ? [`${relative(process.cwd(), filePath)} matches ${pattern.source}`]
            : []
        );
      }
    );

    expect(violations).toEqual([]);
  });
});

function listTypeScriptFiles(directoryUrl: URL): string[] {
  const directoryPath = fileURLToPath(directoryUrl);
  return readdirSync(directoryPath, { withFileTypes: true }).flatMap(
    (entry) => {
      const childPath = join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return listTypeScriptFiles(new URL(`${entry.name}/`, directoryUrl));
      }
      if (entry.isFile() && basename(entry.name).endsWith(".ts")) {
        return [childPath];
      }
      return [];
    }
  );
}
