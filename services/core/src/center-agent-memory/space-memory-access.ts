import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { buildSpaceMessageEvidence } from "@openmeld/protocol";
import { centerAgentEvidenceSourceSpaceSchema } from "@openmeld/schemas";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { createAuthenticatedSpaceAccessContext } from "@openmeld/space";
import { requireActiveHumanMember } from "../center-agent/application/represented-member-request";
import type { CoreBindings } from "../lib/bindings";
import { readCoreRpcHttpStatus } from "../rpc/errors";
import type { ListSignalsResult } from "../rpc/methods";
import { resolveSpaceStub } from "../rpc/space-ref";
import type { CenterAgentMemorySpaceAccess } from "./contract";

/** Reuse current member and owning-Space authorization for capture and recall. */
export function createCenterAgentMemorySpaceAccess(
  env: CoreBindings
): CenterAgentMemorySpaceAccess {
  async function authorize(
    input: Parameters<CenterAgentMemorySpaceAccess["canRead"]>[0]
  ) {
    const member = await requireActiveHumanMember({
      db: getPostgresDatabase(env),
      organizationId: input.organizationId,
      speakerMember: input.speakerMember,
    });
    const context: OpenMeldRequestContext = {
      activeOrganizationId: input.organizationId,
      actorContext: {
        callerPrincipalId: member.userId,
        ownerUserId: member.userId,
        openMeldProfileId: member.profileId,
        profileKind: "human",
        profileName: member.displayName,
        requestId: `memory:${crypto.randomUUID()}`,
      },
    };
    const stub = resolveSpaceStub(env.OPENMELD_SPACES, input.spaceId);
    if (!stub) {
      throw new Error("center_agent_memory.space_owner_unavailable");
    }
    const spaceAccess = createAuthenticatedSpaceAccessContext({
      requestContext: context,
      spaceId: input.spaceId,
    });
    const source = centerAgentEvidenceSourceSpaceSchema.parse(
      await stub.rpcGetEvidenceReadContext({
        spaceId: input.spaceId,
        spaceAccess,
      })
    );
    if (source.meta.spaceId !== input.spaceId) {
      throw new Error("center_agent_memory.space_source_identity_mismatch");
    }
    return source.meta.organizationId === input.organizationId &&
      !source.isDirectMessage
      ? { stub, spaceAccess }
      : null;
  }
  return {
    async canRead(input) {
      try {
        return Boolean(await authorize(input));
      } catch (error) {
        if (isDeniedOrMissing(error)) {
          return false;
        }
        throw error;
      }
    },
    async readSource(input) {
      try {
        const access = await authorize(input);
        if (!access) {
          return null;
        }
        const page = (await access.stub.rpcListSignals({
          spaceId: input.spaceId,
          spaceAccess: access.spaceAccess,
          aroundSignalId: input.signalId,
          beforeCount: 0,
          afterCount: 0,
          signalTypes: ["signal.text"],
        })) as ListSignalsResult;
        const signal = page.signals.find((item) => item.id === input.signalId);
        if (
          !signal ||
          signal.spaceId !== input.spaceId ||
          signal.type !== "signal.text"
        ) {
          return null;
        }
        if (signal.data.meta?.recalledAt !== undefined) {
          return null;
        }
        const evidence = await buildSpaceMessageEvidence({
          spaceId: input.spaceId,
          signal,
        });
        return {
          text: signal.data.text,
          version: evidence.message.sourceRef.version,
          occurredAtMs:
            signal.data.meta?.editedAt ??
            Date.parse(evidence.message.occurredAt),
          author: evidence.message.author,
        };
      } catch (error) {
        if (isDeniedOrMissing(error)) {
          return null;
        }
        throw error;
      }
    },
  };
}

function isDeniedOrMissing(error: unknown) {
  const status = readCoreRpcHttpStatus(error);
  return status === 401 || status === 403 || status === 404;
}
