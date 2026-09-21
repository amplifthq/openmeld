import { resolveCenterAgentContextScopePlan } from "@openmeld/agent-runtime";
import { getSpaceMetaResponseSchema } from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  RemoteAgentTurnEnvelope,
  SpaceMeta,
} from "@openmeld/schemas/types";
import { createAuthenticatedSpaceAccessContext } from "@openmeld/space";
import { type CoreBindings, wakeEvidenceDb } from "../../lib/bindings";
import { readRemoteAgentNativeDeliveryBySubmissionId } from "../../remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import { resolveSpaceStub } from "../../rpc/space-ref";
import type { prepareCenterAgentRepresentedMemberRequest } from "./represented-member-request";

type RepresentedRequest = Awaited<
  ReturnType<typeof prepareCenterAgentRepresentedMemberRequest>
>;

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
  const audience = envelope
    ? resolveCenterAgentContextScopePlan(envelope).interactionEnvironment
    : null;
  const permittedSpaces = new Map<string, Promise<SpaceMeta | null>>();

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
        const stub = resolveSpaceStub(input.env.OPENMELD_SPACES, spaceId);
        if (!stub) {
          return null;
        }
        // The canonical Space owner checks current membership/access, including
        // revocation. Public listing visibility alone is never read authority.
        const meta = getSpaceMetaResponseSchema.parse(
          await stub.rpcGetMeta({
            spaceId,
            spaceAccess: createAuthenticatedSpaceAccessContext({
              requestContext: memberContext,
              spaceId,
            }),
          })
        );
        if (
          meta.spaceId !== spaceId ||
          meta.organizationId !== organizationId
        ) {
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

  return { audience, envelope, memberContext, readPermittedSpace };
}

async function readVerifiedCurrentEnvelope(input: {
  env: CoreBindings;
  prepared: RepresentedRequest;
}): Promise<RemoteAgentTurnEnvelope | null> {
  const { authorization, representedHuman, sourceNativeDeliveryId } =
    input.prepared;
  const submissionId = authorization.context.agentControllerConversationId;
  const db = wakeEvidenceDb(input.env);
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
