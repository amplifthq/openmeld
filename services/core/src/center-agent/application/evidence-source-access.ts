import { resolveCenterAgentContextScopePlan } from "@openmeld/agent-runtime";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { buildSpaceMessageEvidence } from "@openmeld/protocol";
import { centerAgentEvidenceSourceSpaceSchema } from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  RemoteAgentTurnEnvelope,
  SpaceMeta,
} from "@openmeld/schemas/types";
import { createAuthenticatedSpaceAccessContext } from "@openmeld/space";
import type { CoreBindings } from "../../lib/bindings";
import { readRemoteAgentNativeDeliveryBySubmissionId } from "../../remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import type { ListSignalsResult } from "../../rpc/methods";
import { resolveSpaceStub } from "../../rpc/space-ref";
import type { VerifiedCenterAgentRepresentedMember } from "./represented-member-request";

type RepresentedRequest = {
  authorization: {
    actorProfileId: string;
    context: OpenMeldRequestContext;
    activeOrganization: { organizationId: string };
  };
  representedHuman: VerifiedCenterAgentRepresentedMember;
  sourceNativeDeliveryId: string | null;
};

const MAX_SOURCE_SPACES_PER_READ = 32;

/** Resolve read authority separately from the Agent's authenticated identity. */
export async function createCenterAgentEvidenceSourceAccess(input: {
  env: CoreBindings;
  prepared: RepresentedRequest;
}) {
  const { authorization, representedHuman } = input.prepared;
  const organizationId = authorization.activeOrganization.organizationId;
  const memberContext: OpenMeldRequestContext = {
    activeOrganizationId: organizationId,
    actorContext: {
      callerPrincipalId: representedHuman.userId,
      ownerUserId: representedHuman.userId,
      openMeldProfileId: representedHuman.profileId,
      profileKind: "human",
      profileName: representedHuman.displayName,
      requestId: authorization.context.actorContext.requestId,
    },
  };
  const envelope = await readVerifiedCurrentEnvelope(input);
  let audience = envelope
    ? resolveCenterAgentContextScopePlan(envelope).interactionEnvironment
    : null;
  const replyContext = envelope
    ? await readAuthorizedSpace(envelope.space.id)
    : null;
  const replySpace = replyContext?.meta ?? null;
  if (
    !replyContext ||
    (audience === "requester_private" &&
      (!replyContext.isDirectMessage || replySpace?.visibility !== "private"))
  ) {
    audience = null;
  }
  const permittedSpaces = new Map<string, Promise<SpaceMeta | null>>();

  async function readAuthorizedSpace(spaceId: string) {
    try {
      const stub = resolveSpaceStub(input.env.OPENMELD_SPACES, spaceId);
      if (!stub) {
        return null;
      }
      const result = centerAgentEvidenceSourceSpaceSchema.parse(
        await stub.rpcGetEvidenceReadContext({
          spaceId,
          spaceAccess: createAuthenticatedSpaceAccessContext({
            requestContext: memberContext,
            spaceId,
          }),
        })
      );
      return result.meta.spaceId === spaceId &&
        result.meta.organizationId === organizationId
        ? result
        : null;
    } catch {
      return null;
    }
  }

  function readPermittedSpace(spaceId: string): Promise<SpaceMeta | null> {
    const retained = permittedSpaces.get(spaceId);
    if (retained) {
      return retained;
    }
    if (
      !audience ||
      audience === "externally_shared" ||
      permittedSpaces.size >= MAX_SOURCE_SPACES_PER_READ
    ) {
      return Promise.resolve(null);
    }
    const read = (async () => {
      try {
        // Reauthorize through the canonical owner, never through listing visibility.
        const meta =
          spaceId === envelope?.space.id
            ? replySpace
            : ((await readAuthorizedSpace(spaceId))?.meta ?? null);
        if (!meta) {
          return null;
        }
        if (audience === "requester_private") {
          return meta;
        }
        // A shared tool result may reveal its own conversation or a genuinely
        // open source, not another private source the requester happens to read.
        if (
          spaceId === envelope?.space.id ||
          (meta.visibility === "public" &&
            meta.accessMode === "public" &&
            !meta.directMessage &&
            !meta.passwordProtected)
        ) {
          return meta;
        }
      } catch {
        // Do not reveal identifiers or whether an inaccessible source exists.
      }
      return null;
    })();
    permittedSpaces.set(spaceId, read);
    return read;
  }

  const permittedSignals = new Map<string, Promise<boolean>>();
  function canReadSignal(
    spaceId: string,
    signalId: string,
    version?: string,
    authorKind?: "human" | "agent" | "system"
  ): Promise<boolean> {
    const key = JSON.stringify([spaceId, signalId, version, authorKind]);
    const retained = permittedSignals.get(key);
    if (retained) {
      return retained;
    }
    if (permittedSignals.size >= 48) {
      return Promise.resolve(false);
    }
    const read = (async () => {
      if (!(await readPermittedSpace(spaceId))) {
        return false;
      }
      try {
        const stub = resolveSpaceStub(input.env.OPENMELD_SPACES, spaceId);
        if (!stub) {
          return false;
        }
        const result = await stub.rpcListSignals({
          spaceId,
          aroundSignalId: signalId,
          beforeCount: 1,
          afterCount: 0,
          signalTypes: ["signal.text"],
          spaceAccess: createAuthenticatedSpaceAccessContext({
            requestContext: memberContext,
            spaceId,
          }),
        });
        const signal = (result as ListSignalsResult).signals.find(
          (item) => item.id === signalId
        );
        if (!signal) {
          return false;
        }
        if (!(version || authorKind)) {
          return true;
        }
        if (signal.type !== "signal.text") {
          return false;
        }
        const evidence = await buildSpaceMessageEvidence({
          signal,
          spaceId,
          version,
        });
        return (
          !authorKind || evidence.message.author.profileKind === authorKind
        );
      } catch {
        return false;
      }
    })();
    permittedSignals.set(key, read);
    return read;
  }

  return {
    audience,
    envelope,
    memberContext,
    readPermittedSpace,
    canReadSignal,
  };
}

async function readVerifiedCurrentEnvelope(input: {
  env: CoreBindings;
  prepared: RepresentedRequest;
}): Promise<RemoteAgentTurnEnvelope | null> {
  const { authorization, representedHuman, sourceNativeDeliveryId } =
    input.prepared;
  const submissionId = authorization.context.agentControllerConversationId;
  const db = getPostgresDatabase(input.env);
  if (!(db && submissionId && sourceNativeDeliveryId)) {
    return null;
  }
  const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
    db,
    submissionId,
  });
  if (
    !delivery ||
    delivery.deliveryId !== sourceNativeDeliveryId ||
    delivery.organizationId !==
      authorization.activeOrganization.organizationId ||
    delivery.profileId !== authorization.actorProfileId ||
    delivery.onBehalfOfProfileId !== representedHuman.profileId ||
    delivery.onBehalfOfUserId !== representedHuman.userId ||
    (delivery.status !== "accepted" && delivery.status !== "retry_observed")
  ) {
    return null;
  }
  const envelope = delivery.executionRecoverySubmitRequest?.turnEnvelope;
  if (
    !envelope ||
    envelope.organization.id !== delivery.organizationId ||
    envelope.space.id !== delivery.spaceId
  ) {
    return null;
  }
  const sender = envelope.sender;
  if (sender.kind !== "routine" && sender.kind !== "member") {
    return null;
  }
  const speaker = sender.kind === "routine" ? sender.delegatedBy : sender;
  return speaker?.verified &&
    speaker.id === representedHuman.memberId &&
    speaker.ownerUserId === representedHuman.userId
    ? envelope
    : null;
}
