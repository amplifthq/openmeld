import { computerConnectionReviewSchema } from "@openmeld/schemas";
import {
  buildStoredAuthSessionIdentity,
  getAuthSessionMetadata,
  getAuthSessionState,
} from "../config/auth-session";
import { readDaemonServiceContract } from "../config/daemon-service-contract";
import { resolveServiceAccountIdentity } from "../local-service/lifecycle/service-account-authorization";
import { readServiceControlCapabilities } from "./service-control-capabilities";

/** Display evidence only. Auth and Service owners validate an existing connection. */
export async function readComputerConnectionReview() {
  const session = await getAuthSessionMetadata();
  if (session && !session.user?.id) {
    throw new Error(
      "The computer account cannot be identified. Review its sign-in before connecting."
    );
  }
  let existingConnection: ReturnType<
    typeof computerConnectionReviewSchema.parse
  >["existingConnection"] = null;
  const contract = await readDaemonServiceContract();
  if (session && contract && contract.ownerUserId === session.user?.id) {
    const auth = await getAuthSessionState({ validateRemote: true });
    if (auth.state === "valid" && auth.session) {
      const identity = await resolveServiceAccountIdentity(
        auth.session,
        contract
      );
      const capabilities = await readServiceControlCapabilities();
      if (capabilities.stop && capabilities.deviceId === identity.deviceId) {
        existingConnection = {
          deviceId: identity.deviceId,
          runtimeLane: identity.lane,
        };
      }
    }
  }
  return computerConnectionReviewSchema.parse({
    protocol: "computer-connection-v1",
    previousSessionIdentity: buildStoredAuthSessionIdentity(session),
    account: session
      ? { id: session.user?.id, email: session.user?.email ?? null }
      : null,
    existingConnection,
  });
}
