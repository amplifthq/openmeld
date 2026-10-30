import { buildSpaceMessageEvidence } from "@openmeld/protocol";
import type {
  CenterAgentRememberForOrganizationBody,
  SignalEnvelope,
} from "@openmeld/schemas/types";
import { createAuthenticatedSpaceAccessContext } from "@openmeld/space";
import { createCenterAgentEvidenceSourceAccess } from "../center-agent/application/evidence-source-access";
import type { CoreBindings } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import type { ListSignalsResult } from "../rpc/methods";
import { resolveSpaceStub } from "../rpc/space-ref";
import type { CenterAgentMemoryEpisodeOrigin } from "./contract";

export async function readExplicitMemorySourceExcerpt(input: {
  env: CoreBindings;
  prepared: Parameters<
    typeof createCenterAgentEvidenceSourceAccess
  >[0]["prepared"];
  fact: string;
  origin: CenterAgentMemoryEpisodeOrigin;
  sourceRef: CenterAgentRememberForOrganizationBody["sourceRef"];
}) {
  const spaceId = input.origin.sourceConversationId;
  return await resolveMemorySourceExcerpt({
    fact: input.fact,
    origin: input.origin,
    sourceRef: input.sourceRef,
    readSource: async (signalId) => {
      const access = await createCenterAgentEvidenceSourceAccess({
        env: input.env,
        prepared: input.prepared,
      });
      if (
        access.audience !== "organization_shared" ||
        !(await access.readPermittedSpace(spaceId))
      ) {
        throw createCoreRpcHttpError({
          status: 403,
          code: "center_agent_memory.source_access_denied",
          reason:
            "The source conversation is no longer available to this requester and audience.",
        });
      }
      const stub = resolveSpaceStub(input.env.OPENMELD_SPACES, spaceId);
      if (!stub) {
        return null;
      }
      const page = (await stub.rpcListSignals({
        spaceId,
        spaceAccess: createAuthenticatedSpaceAccessContext({
          requestContext: access.memberContext,
          spaceId,
        }),
        aroundSignalId: signalId,
        beforeCount: 0,
        afterCount: 0,
        signalTypes: ["signal.text"],
      })) as ListSignalsResult;
      return page.signals.find((signal) => signal.id === signalId) ?? null;
    },
  });
}

/** Bind a selected excerpt to the original message, never the later save request.
 * Source access is checked by the caller through the owning Space. */
export async function resolveMemorySourceExcerpt(input: {
  fact: string;
  origin: CenterAgentMemoryEpisodeOrigin;
  sourceRef: CenterAgentRememberForOrganizationBody["sourceRef"];
  readSource: (signalId: string) => Promise<SignalEnvelope | null>;
}): Promise<CenterAgentMemoryEpisodeOrigin> {
  if (
    input.origin.source !== "space_conversation" &&
    input.origin.source !== "ca_dm"
  ) {
    if (input.sourceRef) {
      throw conflict(
        "source_surface_mismatch",
        "A Space reference cannot identify a Channel source."
      );
    }
    return input.origin;
  }
  const sourceRef = input.sourceRef;
  if (!sourceRef || sourceRef.spaceId !== input.origin.sourceConversationId) {
    throw conflict(
      "source_reference_required",
      "Read the original message with source_evidence and provide its source reference and an exact excerpt."
    );
  }
  const source = await input.readSource(sourceRef.sourceSignalId);
  if (
    !source ||
    source.spaceId !== sourceRef.spaceId ||
    source.id !== sourceRef.sourceSignalId ||
    source.type !== "signal.text"
  ) {
    throw conflict(
      "source_unavailable",
      "The original text message is no longer available."
    );
  }
  let evidence: Awaited<ReturnType<typeof buildSpaceMessageEvidence>>;
  try {
    evidence = await buildSpaceMessageEvidence({
      signal: source,
      spaceId: sourceRef.spaceId,
      version: sourceRef.version,
    });
  } catch {
    throw conflict(
      "source_version_changed",
      "The original message changed or was recalled. Read its current version before saving."
    );
  }
  if (!source.data.text.includes(input.fact)) {
    throw conflict(
      "source_excerpt_mismatch",
      "Save an exact excerpt of the referenced message. An Agent-authored paraphrase is not the source statement."
    );
  }
  return {
    ...input.origin,
    occurredAtMs:
      source.data.meta?.editedAt ?? Date.parse(evidence.message.occurredAt),
    sourceMessageId: source.id,
    sourceVersion: evidence.message.sourceRef.version,
    sourceAuthorKind: evidence.message.author.profileKind,
  };
}

function conflict(code: string, reason: string) {
  return createCoreRpcHttpError({
    status: 409,
    code: `center_agent_memory.${code}`,
    reason,
  });
}
