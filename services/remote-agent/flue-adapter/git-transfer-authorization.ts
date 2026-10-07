import type { RemoteAgentGitTransferGrant } from "@openmeld/schemas";
import type { RemoteAgentCoreWorkerBinding } from "../agent-core/callback-context";
import { authorizeRemotePluginConnection } from "./plugin-connection-authorization";

/** Git shares selected-account authorization with other native Plugin reads. */
export async function authorizeGitTransfer(
  core: RemoteAgentCoreWorkerBinding,
  grant: RemoteAgentGitTransferGrant
) {
  return await authorizeRemotePluginConnection(core, grant, "github");
}
