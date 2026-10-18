import { getPostgresDatabase } from "@openmeld/db/postgresql";
import type {
  OpenMeldDaemonDispatchQueueMessage,
  RequestChain,
} from "@openmeld/schemas/types";
import { readCenterAgentWakeAuditAttribution } from "../center-agent/center-agent-repository";
import type { CoreBindings } from "../lib/bindings";
import { readRemoteAgentNativeDeliveryByDeliveryId } from "../remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import {
  appendRequestChainAgent,
  parseRequestChain,
  type RequestChainResult,
  readRequestChainRootProfileId,
  requestChainIncludesAgent,
  startRequestChain,
} from "./request-chain";

/**
 * Core-supplied facts about a signal's origin. Only trusted Core paths set
 * this; a client or Agent request never does.
 */
type CallerRelationship = NonNullable<
  NonNullable<
    OpenMeldDaemonDispatchQueueMessage["sourceSignalSnapshot"]
  >["callerContext"]
>["relationship"];

export type RequestChainBasis =
  // The chain of the Wake whose Agent authored this signal.
  | { kind: "parent"; requestChain: RequestChain }
  // A human-authored signal published for a Routine run.
  | { kind: "source"; source: "routine"; sourceId: string }
  // The Wake (in the same Space) whose hosted Agent authored this signal.
  // The Space resolves it to that Wake's chain before planning.
  | { kind: "wake"; dispatchId: string };

export type DispatchRequestChainPlan =
  | RequestChainResult
  // No trusted basis at the Space; Core admission derives the chain.
  | { ok: "deferred" };

/** The chain the Space writes on one outbox seed for one Wake target. */
export function planDispatchRequestChain(input: {
  author: { kind: "agent" | "human" | "system"; profileId: string };
  basis?: RequestChainBasis;
  relationship?: CallerRelationship;
  targetProfileId: string;
}): DispatchRequestChainPlan {
  if (input.author.kind === "human") {
    if (input.relationship === "anonymous") {
      return { ok: false, reasonCode: "request_chain.anonymous_requester" };
    }
    if (input.basis?.kind === "parent") {
      return { ok: false, reasonCode: "request_chain.parent_mismatch" };
    }
    return appendRequestChainAgent({
      agentProfileId: input.targetProfileId,
      chain: startRequestChain({
        rootProfileId: input.author.profileId,
        ...(input.basis?.kind === "source"
          ? {
              source: {
                source: input.basis.source,
                sourceId: input.basis.sourceId,
              },
            }
          : {}),
      }),
      hop: "conversational",
    });
  }
  if (input.author.kind === "agent" && input.basis?.kind === "parent") {
    // The authoring Agent must be in the chain it continues.
    if (
      !requestChainIncludesAgent(
        input.basis.requestChain,
        input.author.profileId
      )
    ) {
      return { ok: false, reasonCode: "request_chain.parent_mismatch" };
    }
    return appendRequestChainAgent({
      agentProfileId: input.targetProfileId,
      chain: input.basis.requestChain,
      hop: "conversational",
    });
  }
  return { ok: "deferred" };
}

export type ResolveAdmittedRequestChainDeps = {
  /** Whether this human Profile is an active member of the Organization. */
  isActiveMemberProfile: (input: {
    organizationId: string;
    profileId: string;
  }) => Promise<boolean>;
  readCenterAgentWakeAttribution: (input: {
    clientMessageId: string;
  }) => Promise<{
    actorProfileId: string;
    onBehalfOfProfileId: string | null;
    organizationId: string;
    resourceId: string | null;
    resourceType: string | null;
    sourceNativeDeliveryId: string | null;
  } | null>;
  /** The member Core recorded on a native delivery, never a tool argument. */
  readNativeDeliveryRoot: (input: { deliveryId: string }) => Promise<{
    onBehalfOfProfileId: string | null;
    onBehalfOfUserId: string | null;
    organizationId: string;
    profileId: string;
  } | null>;
};

/**
 * The chain Core freezes on this Wake's assignment. A chain the Space wrote
 * is kept as is; otherwise Core derives it from the existing delegation
 * facts. A result that is not ok means this Wake has no human root.
 */
export async function resolveAdmittedRequestChain(input: {
  deps: ResolveAdmittedRequestChainDeps;
  message: OpenMeldDaemonDispatchQueueMessage;
}): Promise<RequestChainResult> {
  const { message } = input;
  if (message.requestChain !== undefined) {
    const chain = parseRequestChain(message.requestChain);
    if (!(chain && requestChainIncludesAgent(chain, message.targetProfileId))) {
      return { ok: false, reasonCode: "request_chain.invalid" };
    }
    // A Routine stops when its creator, the root, leaves the Organization.
    if (
      chain[1]?.kind === "source" &&
      !(
        message.organizationId &&
        (await input.deps.isActiveMemberProfile({
          organizationId: message.organizationId,
          profileId: readRequestChainRootProfileId(chain),
        }))
      )
    ) {
      return { ok: false, reasonCode: "request_chain.root_unavailable" };
    }
    return { ok: true, chain };
  }
  const source = message.sourceSignalSnapshot;
  if (!source?.profileId) {
    return { ok: false, reasonCode: "request_chain.root_required" };
  }
  if (source.profileKind === "human") {
    // A seed written before the Space recorded chains.
    return planHumanRootedChain({
      authorProfileId: source.profileId,
      relationship: source.callerContext?.relationship,
      targetProfileId: message.targetProfileId,
    });
  }
  const clientMessageId = message.sourceClientMessageId;
  if (
    source.profileKind === "agent" &&
    clientMessageId?.startsWith("ca-wake:")
  ) {
    // Center Agent delegation: its Core-written audit attribution names the
    // member the Center Agent acted for.
    const attribution = await input.deps.readCenterAgentWakeAttribution({
      clientMessageId,
    });
    if (
      !(
        attribution?.onBehalfOfProfileId &&
        attribution.sourceNativeDeliveryId &&
        attribution.organizationId === message.organizationId &&
        attribution.resourceType === "space" &&
        attribution.resourceId === message.spaceId &&
        attribution.actorProfileId === source.profileId
      )
    ) {
      return { ok: false, reasonCode: "request_chain.root_required" };
    }
    // The attribution must name the member of the Center Agent turn that
    // sent this Wake, as Core recorded it on that turn's native delivery.
    const turn = await input.deps.readNativeDeliveryRoot({
      deliveryId: attribution.sourceNativeDeliveryId,
    });
    if (
      !(
        turn?.onBehalfOfUserId &&
        turn.organizationId === message.organizationId &&
        turn.profileId === source.profileId &&
        turn.onBehalfOfProfileId === attribution.onBehalfOfProfileId
      )
    ) {
      return { ok: false, reasonCode: "request_chain.root_required" };
    }
    const delegator = appendRequestChainAgent({
      agentProfileId: source.profileId,
      chain: startRequestChain({
        rootProfileId: attribution.onBehalfOfProfileId,
      }),
      hop: "conversational",
    });
    return delegator.ok
      ? appendRequestChainAgent({
          agentProfileId: message.targetProfileId,
          chain: delegator.chain,
          hop: "delegated",
        })
      : delegator;
  }
  return { ok: false, reasonCode: "request_chain.root_required" };
}

function planHumanRootedChain(input: {
  authorProfileId: string;
  relationship?: CallerRelationship;
  targetProfileId: string;
}): RequestChainResult {
  const plan = planDispatchRequestChain({
    author: { kind: "human", profileId: input.authorProfileId },
    relationship: input.relationship,
    targetProfileId: input.targetProfileId,
  });
  return plan.ok === "deferred"
    ? { ok: false, reasonCode: "request_chain.root_required" }
    : plan;
}

export function createAdmittedRequestChainDeps(
  env: CoreBindings | undefined
): ResolveAdmittedRequestChainDeps {
  return {
    isActiveMemberProfile: async ({ organizationId, profileId }) => {
      const db = env ? getPostgresDatabase(env) : null;
      if (!db) {
        return false;
      }
      const result = await db.query({
        text: `SELECT 1 FROM "openmeld"."openmeld_profiles" p
          JOIN "openmeld"."members" m
            ON m.user_id = p.owner_user_id AND m.organization_id = $1
          WHERE p.profile_id = $2 AND p.profile_kind = 'human'
            AND p.status = 'active'
          LIMIT 1`,
        values: [organizationId, profileId],
      });
      return result.rows.length > 0;
    },
    readCenterAgentWakeAttribution: async ({ clientMessageId }) => {
      const db = env ? getPostgresDatabase(env) : null;
      if (!db) {
        return null;
      }
      return await readCenterAgentWakeAuditAttribution({ clientMessageId, db });
    },
    readNativeDeliveryRoot: async ({ deliveryId }) => {
      const db = env ? getPostgresDatabase(env) : null;
      if (!db) {
        return null;
      }
      return await readRemoteAgentNativeDeliveryByDeliveryId({
        db,
        deliveryId,
      });
    },
  };
}
