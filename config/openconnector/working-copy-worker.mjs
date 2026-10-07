// Copied alongside the pinned upstream checkout only by deploy-openconnector.

import { withGitWorkingCopyPolicy } from "./.openmeld-github-working-copy-policy.mjs";
import upstream from "./src/server/cloudflare.ts";

export default withGitWorkingCopyPolicy(upstream);
