import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseJsoncObject } from "../../packages/db/src/tooling/parse-jsonc.ts";

export const CUTOVER_CONFIG_NAME = ".openmeld-pg-cutover.jsonc";
export const CUTOVER_CONFIG_ENV = "OPENMELD_RELEASE_POSTGRESQL_CUTOVER";

function deriveConfig(root, scope) {
  if (!["auth", "core"].includes(scope)) {
    throw new Error("Unknown PostgreSQL cutover Worker");
  }
  const config = parseJsoncObject(
    readFileSync(path.join(root, "services", scope, "wrangler.jsonc"), "utf8")
  );
  if (!Array.isArray(config.env?.prod?.triggers?.crons)) {
    throw new Error(
      "Cutover requires an explicit production cron configuration"
    );
  }
  config.env.prod.triggers.crons = [];
  return config;
}

// Same directory preserves every Wrangler-relative path. This file is derived
// for one guarded operation; it is neither an override input nor another truth.
export async function withPostgresqlCutoverConfig(root, enabled, execute) {
  if (!enabled) {
    return execute({ ...process.env, [CUTOVER_CONFIG_ENV]: undefined });
  }
  const created = [];
  try {
    for (const scope of ["auth", "core"]) {
      const file = path.join(root, "services", scope, CUTOVER_CONFIG_NAME);
      writeFileSync(
        file,
        `${JSON.stringify(deriveConfig(root, scope), null, 2)}\n`,
        { flag: "wx", mode: 0o600 }
      );
      created.push(file);
    }
    return await execute({ ...process.env, [CUTOVER_CONFIG_ENV]: "1" });
  } finally {
    for (const file of created) {
      unlinkSync(file);
    }
  }
}

export function cutoverConfigArgs(
  scope,
  { cwd = process.cwd(), env = process.env } = {}
) {
  if (env[CUTOVER_CONFIG_ENV] !== "1") {
    return [];
  }
  const actual = parseJsoncObject(
    readFileSync(path.join(cwd, "services", scope, CUTOVER_CONFIG_NAME), "utf8")
  );
  if (!isDeepStrictEqual(actual, deriveConfig(cwd, scope))) {
    throw new Error(
      "Cutover configuration may change only prod triggers.crons to []"
    );
  }
  return ["--config", CUTOVER_CONFIG_NAME];
}

export function cutoverDeploySteps(steps) {
  return steps.map((step) => {
    const rewrite = (args) =>
      args?.map((arg) =>
        [
          "services/auth/wrangler.jsonc",
          "services/core/wrangler.jsonc",
        ].includes(arg)
          ? arg.replace("wrangler.jsonc", CUTOVER_CONFIG_NAME)
          : arg
      );
    return {
      ...step,
      ...(step.workerDeploymentArgs
        ? { workerDeploymentArgs: rewrite(step.workerDeploymentArgs) }
        : {}),
      ...(step.receiptWorkerDeploymentArgs
        ? {
            receiptWorkerDeploymentArgs: rewrite(
              step.receiptWorkerDeploymentArgs
            ),
          }
        : {}),
      ...(step.releaseScope === "auth" && step.workerDeploymentArgs
        ? { args: [...step.args, "--config", CUTOVER_CONFIG_NAME] }
        : {}),
    };
  });
}
