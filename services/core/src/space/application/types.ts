import type {
  SpaceSignalAuthoringPolicy,
  SpaceThreadContext,
  SpaceThreadSignalPlacementKind,
} from "@openmeld/schemas/types";
import type { SpaceMetaRecord } from "../infrastructure/sql/space-meta-repo";

export type PasswordAuthorizationResult =
  | { ok: true; meta: SpaceMetaRecord }
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
  agentReplyObservation?: {
    observedThroughSignalId: string;
    sourceSignalId: string;
    targetProfileId: string;
  };
  agentStreamId?: string;
  authoringPolicy?: SpaceSignalAuthoringPolicy;
  finalOutcomeAuthority?: FinalOutcomeWriteAuthority;
  sourceDispatchChainContext?: SourceDispatchChainContext;
  spacePassword?: string;
  supportsCurrentSpaceAddressing?: boolean;
  threadContext?: SpaceThreadContext;
  threadPlacement?: SpaceThreadSignalPlacementKind;
};
