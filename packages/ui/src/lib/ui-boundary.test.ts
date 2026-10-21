/// <reference types="node" />

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Standing boundary guard (see developing/clients/shell-and-settings.md §9): the
 * shared UI package must stay purely presentational. It must NOT import a router
 * or electron/electron-store, reach for the desktop bridge global, OR touch
 * storage directly — navigation, data, and PERSISTENCE are always INJECTED by
 * each client (Web cookie / Desktop electron-store). Forbidding storage here is
 * what makes "persistence is injected" enforceable: a vendored engine cannot
 * self-persist to document.cookie. Scans the whole package source so it guards
 * the future shared shell/settings components, not just the Phase-0 contract.
 */

const SOURCE_RE = /\.(tsx?)$/;
const SELF = "ui-boundary.test";
// Vitest runs from the package root (packages/ui), so the source tree is ./src.
const SRC_DIR = join(process.cwd(), "src");

const FORBIDDEN_MODULES = [
  "@tanstack/react-router",
  "@tanstack/router",
  "electron",
  "electron-store",
];
// Match a real import/require/re-export of a forbidden module (incl. subpaths
// and side-effect `import "mod"`) — NOT a prose mention in a comment.
const MODULE_PATTERNS = FORBIDDEN_MODULES.map(
  (mod) =>
    new RegExp(
      `(?:from\\s+|import\\s+|import\\s*\\(\\s*|require\\s*\\(\\s*)["']${mod}(?:/[^"']*)?["']`
    )
);
// Bare access to platform globals the shared package must never touch:
// the desktop bridge, and any direct browser storage (persistence is injected).
const FORBIDDEN_GLOBALS = [
  "window.openmeld",
  "document.cookie",
  "localStorage",
  "sessionStorage",
];

function sourceFiles(): string[] {
  return readdirSync(SRC_DIR, { recursive: true })
    .map((entry) => String(entry))
    .filter((file) => SOURCE_RE.test(file) && !file.includes(SELF));
}

describe("packages/ui platform boundary", () => {
  it("imports no router/electron and touches no storage or desktop bridge", () => {
    const files = sourceFiles();
    // Guard against a mis-resolved source dir silently passing on zero files.
    expect(files.length).toBeGreaterThan(5);

    const offenders: string[] = [];
    for (const relativePath of files) {
      const content = readFileSync(join(SRC_DIR, relativePath), "utf8");
      for (const pattern of MODULE_PATTERNS) {
        if (pattern.test(content)) {
          offenders.push(`${relativePath} -> ${pattern.source}`);
        }
      }
      for (const needle of FORBIDDEN_GLOBALS) {
        if (content.includes(needle)) {
          offenders.push(`${relativePath} -> ${needle}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
