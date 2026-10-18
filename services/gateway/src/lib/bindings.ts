import type { RequestCredential } from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  ResolvedOpenMeldProfile,
} from "@openmeld/schemas/types";
import type { SpaceAccessContext } from "@openmeld/space";
import type { GatewayAuthClaims } from "./auth-rpc-client";
import type { GatewayIngressForwardingContext } from "./ingress-forwarding-context";

type CoreRpcWorker = Service<
  typeof import("../../../core/src/index").GatewayRpcEntrypoint
>;
type AuthRpcWorker = Service<
  typeof import("../../../auth/src/index").GatewayAuthRpcEntrypoint
>;

export type HonoBindings = {
  Bindings: CloudflareBindings;
  Variables: {
    ingressOpenMeldContext: GatewayIngressForwardingContext;
    openMeldRequestContext: OpenMeldRequestContext;
    // Credential facts for sensitive operations only; never part of the
    // request context (it can carry a task's execution token).
    requestCredential: RequestCredential;
    startedAt: number;
    coreRpc: CoreRpcWorker;
    authRpc: AuthRpcWorker;
    authClaims: GatewayAuthClaims;
    feedbackSubmitterUserId?: string;
    resolvedProfile: ResolvedOpenMeldProfile;
    spaceAccessContext?: SpaceAccessContext;
  };
};
