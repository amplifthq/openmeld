import assert from "node:assert/strict";
import test from "node:test";

import { requireProductionDatabaseCurrent } from "./require-production-db-current.mjs";

const PENDING_DATABASE_ERROR_PATTERN =
  /Production database is behind the release source.*scope `database`.*0149_rapid_venus\.sql/su;
const INCONCLUSIVE_DATABASE_ERROR_PATTERN =
  /could not prove that the Production database is current.*authentication failed/su;

test("allows a CLI/Core release only when Production has no pending D1 migrations", () => {
  const commands = [];

  const result = requireProductionDatabaseCurrent({
    cwd: "/release-source",
    runCommand: (command) => {
      commands.push(command);
      return {
        status: 0,
        stderr: "",
        stdout: "No migrations to apply.\n",
      };
    },
  });

  assert.deepEqual(result, {
    status: "current",
    reason: "the remote D1 pending migration list is empty",
  });
  assert.deepEqual(commands, [
    {
      command: "pnpm",
      args: [
        "-C",
        "services/auth",
        "exec",
        "wrangler",
        "d1",
        "migrations",
        "list",
        "OPENMELD_DB",
        "--config",
        "wrangler.jsonc",
        "--env",
        "prod",
        "--remote",
      ],
      cwd: "/release-source",
    },
  ]);
});

test("blocks CLI/Core publication before mutation when Production D1 is behind", () => {
  assert.throws(
    () =>
      requireProductionDatabaseCurrent({
        cwd: "/release-source",
        runCommand: () => ({
          status: 0,
          stderr: "",
          stdout: "Migrations to be applied:\n0149_rapid_venus.sql\n",
        }),
      }),
    PENDING_DATABASE_ERROR_PATTERN
  );
});

test("fails closed when the Production D1 migration probe is inconclusive", () => {
  assert.throws(
    () =>
      requireProductionDatabaseCurrent({
        cwd: "/release-source",
        runCommand: () => ({
          status: 1,
          stderr: "authentication failed",
          stdout: "",
        }),
      }),
    INCONCLUSIVE_DATABASE_ERROR_PATTERN
  );
});

test("does not treat an empty successful migration probe as current", () => {
  assert.throws(
    () =>
      requireProductionDatabaseCurrent({
        cwd: "/release-source",
        runCommand: () => ({
          status: 0,
          stderr: "",
          stdout: "",
        }),
      }),
    /could not prove that the Production database is current.*no diagnostic output/su
  );
});

test("does not treat an unknown successful migration response as current", () => {
  assert.throws(
    () =>
      requireProductionDatabaseCurrent({
        cwd: "/release-source",
        runCommand: () => ({
          status: 0,
          stderr: "",
          stdout: "Wrangler completed without a migration summary.\n",
        }),
      }),
    /could not prove that the Production database is current.*Wrangler completed without a migration summary/su
  );
});
