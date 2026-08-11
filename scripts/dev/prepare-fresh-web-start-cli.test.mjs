import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertSafeTempOpenMeldHome,
  parseCli,
  renderShellExport,
  resolveFreshOpenMeldHome,
} from "./prepare-fresh-web-start-cli.mts";

const DEFAULT_OPENMELD_HOME = join(tmpdir(), "openmeld-web-start-fresh");
const NON_TEMP_OPENMELD_HOME_RE = /only allows OPENMELD_HOME under/;
const MISSING_EMAIL_RE = /prepare-fresh-web-start-cli requires --email/;
const EXPECTED_SHELL_EXPORT_LINE = `export OPENMELD_HOME="${DEFAULT_OPENMELD_HOME.replaceAll(
  "\\",
  "\\\\"
).replaceAll('"', '\\"')}"`;
const EXPECTED_VITE_SHELL_EXPORT_LINE = `export VITE_OPENMELD_HOME="${DEFAULT_OPENMELD_HOME.replaceAll(
  "\\",
  "\\\\"
).replaceAll('"', '\\"')}"`;
const BROWSER_CLEANUP_HINT_RE = /Browser data is not changed/;
const DATABASE_MIGRATION_HINT_RE = /Local DB migrations are not changed/;
const FRESH_SERVICE_CLEANUP_HINT_RE =
  /openmeld-dev service stop --force --view agent/;
const UNSET_HINT_RE = /unset OPENMELD_HOME/;

test("parseCli normalizes the email and enables clear-auth-sessions", () => {
  const options = parseCli([
    "--email",
    " Demo@Example.com ",
    "--clear-auth-sessions",
  ]);

  assert.equal(options.email, "demo@example.com");
  assert.equal(options.clearAuthSessions, true);
  assert.equal(options.printShellExport, false);
  assert.equal(options.openMeldHome, DEFAULT_OPENMELD_HOME);
});

test("parseCli enables print-shell-export", () => {
  const options = parseCli([
    "--email",
    "demo@example.com",
    "--print-shell-export",
  ]);

  assert.equal(options.printShellExport, true);
});

test("parseCli ignores the pnpm argument separator", () => {
  const options = parseCli(["--", "--email", "demo@example.com"]);

  assert.equal(options.email, "demo@example.com");
});

test("resolveFreshOpenMeldHome keeps the default OPENMELD_HOME under the temp root", () => {
  assert.equal(resolveFreshOpenMeldHome(undefined), DEFAULT_OPENMELD_HOME);
});

test("assertSafeTempOpenMeldHome rejects non-temp OPENMELD_HOME paths", () => {
  assert.throws(
    () => assertSafeTempOpenMeldHome("/Users/felix/.openmeld-dev"),
    NON_TEMP_OPENMELD_HOME_RE
  );
});

test("parseCli requires --email", () => {
  assert.throws(() => parseCli([]), MISSING_EMAIL_RE);
});

test("renderShellExport returns a sourceable export command", () => {
  const shellSnippet = renderShellExport(DEFAULT_OPENMELD_HOME);
  const shellLines = shellSnippet.split("\n");

  assert.equal(shellLines[0], EXPECTED_SHELL_EXPORT_LINE);
  assert.equal(shellLines[1], EXPECTED_VITE_SHELL_EXPORT_LINE);
  assert.match(shellSnippet, BROWSER_CLEANUP_HINT_RE);
  assert.match(shellSnippet, DATABASE_MIGRATION_HINT_RE);
  assert.match(shellSnippet, FRESH_SERVICE_CLEANUP_HINT_RE);
  assert.match(shellSnippet, UNSET_HINT_RE);
});
