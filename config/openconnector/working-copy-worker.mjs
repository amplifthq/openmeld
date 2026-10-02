// Copied alongside the pinned upstream checkout only by deploy-openconnector.

import { withGitHubProxyRuntimeContext } from "./.openmeld-github-proxy-runtime-context.mjs";
import { withGitWorkingCopyPolicy } from "./.openmeld-github-working-copy-policy.mjs";
import { executorModules } from "./src/providers/registry.cloudflare.generated.ts";
import upstream from "./src/server/cloudflare.ts";

export default withGitWorkingCopyPolicy(
  withGitHubProxyRuntimeContext(upstream, executorModules)
);
