import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  assertArtifactCheckout,
  checkProductionArtifact,
} from "./production-artifact-check.mjs";
import { PARENT_ADMISSION_ENV } from "./production-train-admission-evidence.mjs";
import { admitProductionTrainArtifacts } from "./production-train-artifact-admission.mjs";

// Called only by the guarded hosted renderer stage, after its live preflight
// and scope lease. The candidate contributes data and verified bytes, not tools.
export async function promoteRendererArtifact(input, dependencies = {}) {
  const { root, sourceSha, scope, env = process.env } = input;
  if (
    !(["web", "website", "docs"].includes(scope) && env[PARENT_ADMISSION_ENV])
  ) {
    throw new Error(
      "Renderer promotion requires a parent-admitted Web, Website, or Docs artifact."
    );
  }
  await (dependencies.admit ?? admitProductionTrainArtifacts)({
    root,
    sourceSha,
    selectedScopes: scope,
    env,
  });
  const receipt = await (dependencies.check ?? checkProductionArtifact)({
    root,
    sourceSha,
    scope,
    requireExisting: true,
  });
  (dependencies.assertCheckout ?? assertArtifactCheckout)(root, sourceSha);
  const require = createRequire(import.meta.url);
  const wrangler =
    dependencies.wrangler ?? require.resolve("wrangler/bin/wrangler.js");
  const result = (dependencies.run ?? spawnSync)(
    process.execPath,
    [wrangler, "deploy", ...(input.dryRun ? ["--dry-run"] : [])],
    {
      cwd: path.join(root, "clients", scope),
      env,
      stdio: "inherit",
    }
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Renderer promotion failed for ${scope} (exit ${result.status}).`
    );
  }
  return receipt;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values } = parseArgs({
    options: {
      scope: { type: "string" },
      "source-sha": { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  await promoteRendererArtifact({
    root: process.cwd(),
    scope: values.scope,
    sourceSha: values["source-sha"],
    dryRun: values["dry-run"],
  });
}
