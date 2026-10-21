import type { PluginConnectionExecutionSource } from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  SpaceSignalAuthoringPolicy,
  SpaceThreadContext,
  SpaceThreadSignalPlacementKind,
  UserRequestTimeContext,
} from "@openmeld/schemas/types";
import type { RemoteAgentNativeDeliveryRecord } from "../../remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import type { RequestChainBasis } from "../../request-chain/dispatch-request-chain";
import type { SpaceMetaRecord } from "../infrastructure/sql/space-meta-repo";

export type PasswordAuthorizationResult =
  | { ok: true; meta: SpaceMetaRecord; organizationPreview?: boolean }
  | { ok: false; response: Response };

export type SourceDispatchChainContext = {
  dispatchChainId: string;
  autoRelayDepth: number;
  visitedProfileIds: string[];
  visitedProfileIdsHash: string;
};

export type FinalOutcomeWriteAuthority =
  | "runtime_coordinator_finalization"
  | "runtime_coordinator_failure_publication"
  | "runtime_coordinator_wake_stop_publication"
  | "remote_agent_native_delivery"
  | "approved_compatibility";

export type SignalPublishContext = {
  // Core-owned authorization context; never read from a signal payload.
  verifiedRequestContext?: OpenMeldRequestContext | null;
  requestTimeContext?: UserRequestTimeContext;
  queuedInputHandoff?: { inputId: string; afterDispatchId: string };
  workRecoveryQueueHandoff?: {
    previousDispatchId: string;
    targetProfileId: string;
  };
  // Read by Space from the canonical native ledger before admission. Never
  // accepted from a browser payload; fresh message checks still commit in SQL.
  pluginContinuationNativeSource?: RemoteAgentNativeDeliveryRecord;
  // Token-free original admission evidence read from the RuntimeCoordinator.
  pluginContinuationLocalSource?: PluginConnectionExecutionSource;
  spaceTaskDeliveryId?: string;
  agentReplyObservation?: {
    observedThroughSignalId: string;
    sourceSignalId: string;
    sourceThreadId?: string | null;
    targetProfileId: string;
  };
  agentStreamId?: string;
  authoringPolicy?: SpaceSignalAuthoringPolicy;
  finalOutcomeAuthority?: FinalOutcomeWriteAuthority;
  sourceDispatchChainContext?: SourceDispatchChainContext;
  // Core-owned origin of this signal's request chain. Set only by trusted Core
  // paths; the agent-supplied chain telemetry above is never a basis.
  requestChainBasis?: RequestChainBasis;
  spacePassword?: string;
  supportsCurrentSpaceAddressing?: boolean;
  threadContext?: SpaceThreadContext;
  threadPlacement?: SpaceThreadSignalPlacementKind;
};
