import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(THIS_DIR, "../../..");

const SCANNED_PATHS = [
  "packages/space/src",
  "clients/web/src/components/spaces",
  "clients/web/src/lib/agents",
  "clients/openmeld-cli/src/ui",
];

const ALLOWED_FILES = new Set([
  "packages/space/src/presentation/space-member-agent-views.ts",
]);

const LEGACY_TOP_LEVEL_READ_PATTERNS = [
  /\bmember\.agentExecutionReadiness\b/,
  /\bmember\.daemonRouteObservation\b/,
  /\bagent\.agentExecutionReadiness\b/,
  /\bagent\.daemonRouteObservation\b/,
  /\binput\.agentMember\.agentExecutionReadiness\b/,
  /\binput\.agentMember\.daemonRouteObservation\b/,
];
const TYPESCRIPT_SOURCE_FILE_PATTERN = /\.(ts|tsx)$/;
const TEST_SOURCE_FILE_PATTERN = /\.(test|integration\.test)\.(ts|tsx)$/;

describe("retired Space member owner diagnostics guardrail", () => {
  it("keeps production consumers behind explicit Space member view helpers", () => {
    const violations = listProductionSourceFiles(SCANNED_PATHS).flatMap(
      (filePath) => {
        const relativePath = relative(REPO_ROOT, filePath);
        if (ALLOWED_FILES.has(relativePath)) {
          return [];
        }

        const content = readFileSync(filePath, "utf8");
        return LEGACY_TOP_LEVEL_READ_PATTERNS.some((pattern) =>
          pattern.test(content)
        )
          ? [relativePath]
          : [];
      }
    );

    expect(violations).toEqual([]);
  });
});

function listProductionSourceFiles(paths: readonly string[]): string[] {
  return paths.flatMap((path) => listSourceFiles(join(REPO_ROOT, path)));
}

function listSourceFiles(path: string): string[] {
  const stats = statSync(path);
  if (stats.isFile()) {
    return isProductionSourceFile(path) ? [path] : [];
  }

  return readdirSync(path).flatMap((entry) =>
    listSourceFiles(join(path, entry))
  );
}

function isProductionSourceFile(path: string): boolean {
  if (!TYPESCRIPT_SOURCE_FILE_PATTERN.test(path)) {
    return false;
  }
  return !TEST_SOURCE_FILE_PATTERN.test(path);
}
