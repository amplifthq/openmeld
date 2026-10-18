import { localComponentsBinaryReleasePolicySchema } from "../../packages/schemas/src/schemas/local-components.ts";
import {
  collectLocalComponentFacts,
  LOCAL_COMPONENTS_POLICY_PATH,
  readLocalComponentsPolicy,
} from "./local-components.mjs";

// This native lane builds a fresh GUI Service carrier from the same source as
// the CLI, so it needs CLI and Service decisions for exactly this version in
// release/local-components-policy.json. It cannot relabel an older Service.
export async function resolveWindowsPreviewComponentPolicy({
  repoRoot,
  version,
}) {
  const policy = await readLocalComponentsPolicy(repoRoot);
  if (policy.version !== version || !(policy.cli && policy.service)) {
    throw new Error(
      `Windows preview ${version} needs cli and service decisions for ${version} in ${LOCAL_COMPONENTS_POLICY_PATH}.`
    );
  }
  const facts = await collectLocalComponentFacts({ repoRoot });
  const decide = (component) => ({
    updatePolicy: policy[component].updatePolicy,
    reason: policy[component].reason.trim(),
  });
  return localComponentsBinaryReleasePolicySchema.parse({
    cli: { ...facts.cli, ...decide("cli") },
    service: { ...facts.service, ...decide("service") },
  });
}

// Bundle hashes depend on build state; the published decision does not.
export function sameWindowsPreviewDecision(left, right) {
  const decision = ({ bundleHash: _b, portableBundleHash: _p, ...rest }) =>
    rest;
  return (
    JSON.stringify(left.cli) === JSON.stringify(right.cli) &&
    JSON.stringify(decision(left.service)) ===
      JSON.stringify(decision(right.service))
  );
}
