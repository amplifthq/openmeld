import type { CoreBindings } from "../../lib/bindings";
import type { PrepareSessionHub } from "../transport/do/prepare-session-hub";

export const resolvePrepareSessionHubShard = (
  env: CoreBindings,
  prepareSessionId: string
): DurableObjectStub<PrepareSessionHub> => {
  const namespace = env.OPENMELD_PREPARE_SESSION_HUB;
  if (!namespace) {
    throw new Error(
      "prepare.session.hub.misconfigured: OPENMELD_PREPARE_SESSION_HUB is not bound"
    );
  }

  const shardId = namespace.idFromName(prepareSessionId);
  return namespace.get(shardId);
};
