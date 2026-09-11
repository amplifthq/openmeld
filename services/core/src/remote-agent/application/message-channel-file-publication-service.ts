import {
  centerAgentPostChannelFileBodySchema,
  centerAgentPostChannelFileResponseSchema,
  MESSAGE_CHANNEL_FILE_MAX_SIZE_BYTES,
} from "@openmeld/schemas";
import type {
  CenterAgentPostChannelFileBody,
  CenterAgentPostChannelFileResponse,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import { prepareCenterAgentRepresentedMemberRequest } from "../../center-agent/application/represented-member-request";
import { writeCenterAgentAuditEntry } from "../../center-agent/center-agent-audit";
import {
  beginCenterAgentPublicationOperation,
  buildCenterAgentPublicationRequestSignature,
  buildCenterAgentPublicationSourceRevision,
  completeCenterAgentPublicationOperation,
  failCenterAgentPublicationOperation,
} from "../../center-agent/center-agent-publication-operation-repository";
import type { CoreBindings } from "../../lib/bindings";
import { createCoreRpcHttpError } from "../../rpc/errors";
import { resolveAdmittedMessageChannelRequest } from "./message-channel-file-service";
import { buildMessageChannelProviderPublicationUuid } from "./provider-publication-uuid";

export type CenterAgentPostChannelFileInput = CenterAgentPostChannelFileBody & {
  context: OpenMeldRequestContext;
};

export async function rpcCenterAgentPostChannelFile(
  env: CoreBindings,
  input: CenterAgentPostChannelFileInput
): Promise<CenterAgentPostChannelFileResponse> {
  const { context, ...body } = input;
  const parsed = centerAgentPostChannelFileBodySchema.safeParse(body);
  if (!parsed.success) {
    throw failure(
      400,
      "invalid_payload",
      "Choose a nonempty file of at most 5 MB from Computer."
    );
  }
  const request = parsed.data;
  const { authorization, representedHuman, sourceNativeDeliveryId } =
    await prepareCenterAgentRepresentedMemberRequest(
      env,
      context,
      request.speakerMember
    );
  if (!sourceNativeDeliveryId) {
    throw failure(
      403,
      "message_channel.file_evidence_required",
      "File sending requires a verified member's current Feishu or Lark request."
    );
  }
  const target = await resolveAdmittedMessageChannelRequest(env, {
    authorization,
    conversationId: request.conversationId,
  });
  if (!target.trigger.filePublicationSupported) {
    throw failure(
      409,
      "message_channel.file_publication_unavailable",
      "This request predates native file sending. Send a new message to use it."
    );
  }
  if (target.delivery.deliveryId !== sourceNativeDeliveryId) {
    throw failure(
      403,
      "message_channel.file_evidence_required",
      "The file destination does not match this request."
    );
  }
  const bytes = await decodeVerifiedFile(request);
  const executionId = target.delivery.dispatchId;
  const requestSignature = await buildCenterAgentPublicationRequestSignature({
    contentSha256: request.contentSha256,
    fileName: request.fileName,
    representedUserId: representedHuman.userId,
    v: 1,
  });
  const claim = await beginCenterAgentPublicationOperation({
    actorProfileId: authorization.actorProfileId,
    db: authorization.db,
    destinationId: `${target.locator.connectionId}:${request.conversationId}:${request.contentSha256}`,
    destinationKind: "message_channel_file",
    nowMs: Date.now(),
    organizationId: authorization.activeOrganization.organizationId,
    operationKey: "source",
    representedUserId: representedHuman.userId,
    requestSignature,
    source: {
      kind: "remote_agent_execution",
      sourceId: executionId,
      sourceRevision: await buildCenterAgentPublicationSourceRevision({
        executionId,
        kind: "remote_agent_execution",
        v: 1,
      }),
    },
  });
  if (claim.outcome === "completed_replay") {
    return centerAgentPostChannelFileResponseSchema.parse(
      JSON.parse(claim.operation.responseJson ?? "null")
    );
  }
  if (claim.outcome !== "claimed") {
    throw failure(
      409,
      `center_agent.publication_${claim.outcome === "outcome_unknown" ? "outcome_unknown" : "in_progress"}`,
      "This file may already have been sent. OpenMeld will not send it again automatically."
    );
  }
  const claimId = claim.operation.claimId;
  if (!claimId) {
    throw new Error("File publication claim is missing its owner.");
  }
  const record = {
    claimId,
    db: authorization.db,
    operationId: claim.operation.id,
  };
  let publicationStarted = false;
  try {
    await writeCenterAgentAuditEntry({
      action: "post_channel_file",
      authorization,
      onBehalfOfProfileId: representedHuman.profileId,
      resource: {
        id: claim.operation.destinationId,
        type: `${target.locator.provider}_file`,
      },
      sourceNativeDeliveryId,
    });
    const uuid = await buildMessageChannelProviderPublicationUuid({
      deliveryId: target.delivery.deliveryId,
      provider: target.locator.provider,
      publicationKind: `file:${claim.operation.id}`,
    });
    publicationStarted = true;
    const result = await target.adapter.publishFile({
      connection: target.connection,
      locator: target.locator,
      bytes,
      fileName: request.fileName,
      providerPublicationIdempotencyKey: uuid,
    });
    if (result.status !== "published") {
      publicationStarted = result.status === "outcome_unknown";
      throw failure(
        502,
        result.reasonCode,
        result.status === "outcome_unknown"
          ? "OpenMeld could not confirm whether the file was sent. Check the conversation before requesting another send."
          : "The file could not be sent to this conversation."
      );
    }
    const response = centerAgentPostChannelFileResponseSchema.parse({
      fileName: request.fileName,
      messageId: result.resultId,
      provider: target.locator.provider,
      sizeBytes: bytes.byteLength,
    });
    await completeCenterAgentPublicationOperation({
      ...record,
      nowMs: Date.now(),
      responseJson: JSON.stringify(response),
    });
    return response;
  } catch (error) {
    await failCenterAgentPublicationOperation({
      ...record,
      nowMs: Date.now(),
      outcome: publicationStarted ? "outcome_unknown" : "failed",
    });
    throw error;
  }
}

async function decodeVerifiedFile(
  input: CenterAgentPostChannelFileBody
): Promise<Uint8Array> {
  const bytes = Uint8Array.from(atob(input.contentBase64), (character) =>
    character.charCodeAt(0)
  );
  if (
    !bytes.byteLength ||
    bytes.byteLength > MESSAGE_CHANNEL_FILE_MAX_SIZE_BYTES
  ) {
    throw failure(
      400,
      "message_channel.file_size_invalid",
      "Files must be nonempty and at most 5 MB."
    );
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hash = Array.from(digest, (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
  if (hash !== input.contentSha256) {
    throw failure(
      400,
      "message_channel.file_digest_mismatch",
      "The file changed before it could be sent. Read it again from Computer."
    );
  }
  return bytes;
}

function failure(status: number, code: string, reason: string): Error {
  return createCoreRpcHttpError({ status, code, reason });
}
