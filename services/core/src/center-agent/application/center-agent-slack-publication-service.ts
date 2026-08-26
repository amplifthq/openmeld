import {
  centerAgentPostSlackChannelMessageResponseSchema,
  centerAgentPostSlackFileResponseSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentPostSlackChannelMessageBody,
  CenterAgentPostSlackChannelMessageResponse,
  CenterAgentPostSlackFileBody,
  CenterAgentPostSlackFileResponse,
} from "@openmeld/schemas/types";
import { createOrganizationDocumentService } from "../../organization-documents/organization-document-service";
import {
  postSlackChannelMessage,
  postSlackFile,
  type SlackChannelMessageTarget,
  SlackMessagePublicationError,
} from "../../remote-agent/application/slack-client";
import { buildSlackFinalReplyPresentation } from "../../remote-agent/application/slack-final-reply-presentation";
import { readRemoteAgentNativeDeliveryBySubmissionId } from "../../remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  readRoutineRecord,
  readRoutineRunRecord,
} from "../../routines/routine-repository";
import { createCoreRpcHttpError } from "../../rpc/errors";
import { writeCenterAgentAuditEntry } from "../center-agent-audit";
import {
  beginCenterAgentPublicationOperation,
  buildCenterAgentPublicationRequestSignature,
  buildCenterAgentPublicationSourceRevision,
  CENTER_AGENT_PUBLICATION_DEFAULT_OPERATION_KEY,
  type CenterAgentPublicationOperationRecord,
  type CenterAgentPublicationSource,
  completeCenterAgentPublicationOperation,
  failCenterAgentPublicationOperation,
} from "../center-agent-publication-operation-repository";
import type { CurrentDesignatedCenterAgentAuthorization } from "../current-designated-center-agent";
import type { VerifiedCenterAgentRepresentedMember } from "./represented-member-request";

type PublicationSource = NonNullable<
  CenterAgentPostSlackChannelMessageBody["publicationSource"]
>;
type SlackFilePublicationSource =
  CenterAgentPostSlackFileBody["publicationSource"];
type CenterAgentPublicationFailurePhase =
  | "complete_operation"
  | "prepare_message"
  | "publish_file"
  | "publish_message"
  | "record_audit";

export async function executeCenterAgentSlackPublication(input: {
  authorization: CurrentDesignatedCenterAgentAuthorization;
  botToken: string;
  publicationSource?: PublicationSource;
  representedHuman: VerifiedCenterAgentRepresentedMember;
  sourceNativeDeliveryId: string | null;
  target: SlackChannelMessageTarget;
  text: string;
  threadTs?: string;
}): Promise<CenterAgentPostSlackChannelMessageResponse> {
  const destinationId = input.threadTs
    ? `${input.target.channelId}:${input.threadTs}`
    : input.target.channelId;
  if (!input.publicationSource) {
    const presentation = await buildSlackFinalReplyPresentation(input.text);
    const attribution = await writeCenterAgentAuditEntry({
      action: "post_slack_channel_message",
      authorization: input.authorization,
      onBehalfOfProfileId: input.representedHuman.profileId,
      resource: { type: "slack_channel", id: destinationId },
      sourceNativeDeliveryId: input.sourceNativeDeliveryId,
    });
    const publication = await postSlackChannelMessage({
      ...presentation,
      botToken: input.botToken,
      target: input.target,
      ...(input.threadTs ? { threadTs: input.threadTs } : {}),
    });
    return buildCenterAgentSlackChannelMessageResponse({
      attribution,
      joinedChannel: publication.joinedChannel,
      messageTs: publication.messageTs,
      organizationId: input.authorization.activeOrganization.organizationId,
      target: input.target,
    });
  }

  const source = await resolveCenterAgentPublicationSource({
    authorization: input.authorization,
    publicationSource: input.publicationSource,
    representedHuman: input.representedHuman,
  });
  const requestSignature = await buildCenterAgentPublicationRequestSignature({
    representedUserId: input.representedHuman.userId,
    text: input.text,
    v: 1,
  });
  const claim = await beginCenterAgentPublicationOperation({
    actorProfileId: input.authorization.actorProfileId,
    db: input.authorization.db,
    destinationId,
    destinationKind: "slack_channel",
    nowMs: Date.now(),
    organizationId: input.authorization.activeOrganization.organizationId,
    operationKey:
      input.publicationSource.kind === "remote_agent_execution"
        ? (input.publicationSource.operationId ??
          CENTER_AGENT_PUBLICATION_DEFAULT_OPERATION_KEY)
        : CENTER_AGENT_PUBLICATION_DEFAULT_OPERATION_KEY,
    representedUserId: input.representedHuman.userId,
    requestSignature,
    source,
  });

  if (claim.outcome === "completed_replay") {
    return parseCompletedPublicationResponse(claim.operation.responseJson);
  }
  if (claim.outcome === "pending_in_progress") {
    throw createCoreRpcHttpError({
      code: "center_agent.publication_in_progress",
      reason:
        "This publication is already in progress. Wait for the current attempt instead of posting it again.",
      status: 409,
    });
  }
  if (claim.outcome === "outcome_unknown") {
    throw createCoreRpcHttpError({
      code: "center_agent.publication_outcome_unknown",
      reason:
        "OpenMeld cannot prove whether this publication reached Slack, so it will not post it again automatically.",
      status: 409,
    });
  }

  const claimId = claim.operation.claimId;
  if (!claimId) {
    throw new Error("Claimed Center Agent publication has no claim id.");
  }

  let presentation: Awaited<
    ReturnType<typeof buildSlackFinalReplyPresentation>
  >;
  try {
    presentation = await buildSlackFinalReplyPresentation(input.text);
  } catch (error) {
    await recordCenterAgentPublicationFailure({
      claimId,
      db: input.authorization.db,
      error,
      operation: claim.operation,
      phase: "prepare_message",
      publicationOutcome: "not_published",
    });
    throw error;
  }

  const attribution = await writeCenterAgentAuditEntry({
    action: "post_slack_channel_message",
    authorization: input.authorization,
    onBehalfOfProfileId: input.representedHuman.profileId,
    resource: { type: "slack_channel", id: destinationId },
    sourceNativeDeliveryId: input.sourceNativeDeliveryId,
  }).catch(async (error) => {
    await recordCenterAgentPublicationFailure({
      claimId,
      db: input.authorization.db,
      error,
      operation: claim.operation,
      phase: "record_audit",
      publicationOutcome: "not_published",
    });
    throw error;
  });

  let publication: Awaited<ReturnType<typeof postSlackChannelMessage>>;
  try {
    publication = await postSlackChannelMessage({
      ...presentation,
      botToken: input.botToken,
      target: input.target,
      ...(input.threadTs ? { threadTs: input.threadTs } : {}),
    });
  } catch (error) {
    await recordCenterAgentPublicationFailure({
      claimId,
      db: input.authorization.db,
      error,
      operation: claim.operation,
      phase: "publish_message",
    });
    throw error;
  }

  const response = buildCenterAgentSlackChannelMessageResponse({
    attribution,
    joinedChannel: publication.joinedChannel,
    messageTs: publication.messageTs,
    organizationId: input.authorization.activeOrganization.organizationId,
    target: input.target,
  });
  try {
    await completeCenterAgentPublicationOperation({
      claimId,
      db: input.authorization.db,
      nowMs: Date.now(),
      operationId: claim.operation.id,
      responseJson: JSON.stringify(response),
    });
  } catch (error) {
    await recordCenterAgentPublicationFailure({
      claimId,
      db: input.authorization.db,
      error,
      operation: claim.operation,
      phase: "complete_operation",
      publicationOutcome: "outcome_unknown",
    });
    throw error;
  }
  return response;
}

export async function executeCenterAgentSlackFilePublication(input: {
  authorization: CurrentDesignatedCenterAgentAuthorization;
  botToken: string;
  bytes: Uint8Array;
  contentSha256: string;
  fileName: string;
  initialComment?: string;
  publicationSource: SlackFilePublicationSource;
  representedHuman: VerifiedCenterAgentRepresentedMember;
  sourceNativeDeliveryId: string;
  target: SlackChannelMessageTarget;
  threadTs?: string;
  title?: string;
}): Promise<CenterAgentPostSlackFileResponse> {
  const targetId = input.threadTs
    ? `${input.target.channelId}:${input.threadTs}`
    : input.target.channelId;
  const destinationId = `${targetId}:${input.contentSha256}`;
  const source = await resolveCenterAgentPublicationSource({
    authorization: input.authorization,
    publicationSource: input.publicationSource,
    representedHuman: input.representedHuman,
  });
  const requestSignature = await buildCenterAgentPublicationRequestSignature({
    contentSha256: input.contentSha256,
    fileName: input.fileName,
    initialComment: input.initialComment ?? null,
    representedUserId: input.representedHuman.userId,
    title: input.title ?? null,
    v: 1,
  });
  const claim = await beginCenterAgentPublicationOperation({
    actorProfileId: input.authorization.actorProfileId,
    db: input.authorization.db,
    destinationId,
    destinationKind: "slack_file",
    nowMs: Date.now(),
    organizationId: input.authorization.activeOrganization.organizationId,
    operationKey: CENTER_AGENT_PUBLICATION_DEFAULT_OPERATION_KEY,
    representedUserId: input.representedHuman.userId,
    requestSignature,
    source,
  });
  if (claim.outcome === "completed_replay") {
    return parseCompletedSlackFilePublicationResponse(
      claim.operation.responseJson
    );
  }
  if (claim.outcome === "pending_in_progress") {
    throw createCoreRpcHttpError({
      code: "center_agent.publication_in_progress",
      reason:
        "This file publication is already in progress. Wait for the current attempt instead of uploading it again.",
      status: 409,
    });
  }
  if (claim.outcome === "outcome_unknown") {
    throw createCoreRpcHttpError({
      code: "center_agent.publication_outcome_unknown",
      reason:
        "OpenMeld cannot prove whether this file reached Slack, so it will not upload it again automatically.",
      status: 409,
    });
  }
  const claimId = claim.operation.claimId;
  if (!claimId) {
    throw new Error("Claimed Center Agent file publication has no claim id.");
  }
  const attribution = await writeCenterAgentAuditEntry({
    action: "post_slack_file",
    authorization: input.authorization,
    onBehalfOfProfileId: input.representedHuman.profileId,
    resource: { type: "slack_file", id: destinationId },
    sourceNativeDeliveryId: input.sourceNativeDeliveryId,
  }).catch(async (error) => {
    await recordCenterAgentPublicationFailure({
      claimId,
      db: input.authorization.db,
      error,
      operation: claim.operation,
      phase: "record_audit",
      publicationOutcome: "not_published",
    });
    throw error;
  });
  let publication: Awaited<ReturnType<typeof postSlackFile>>;
  try {
    publication = await postSlackFile({
      botToken: input.botToken,
      bytes: input.bytes,
      fileName: input.fileName,
      target: input.target,
      ...(input.initialComment ? { initialComment: input.initialComment } : {}),
      ...(input.threadTs ? { threadTs: input.threadTs } : {}),
      ...(input.title ? { title: input.title } : {}),
    });
  } catch (error) {
    await recordCenterAgentPublicationFailure({
      claimId,
      db: input.authorization.db,
      error,
      operation: claim.operation,
      phase: "publish_file",
    });
    throw error;
  }
  const response = centerAgentPostSlackFileResponseSchema.parse({
    attribution,
    channelName: input.target.channelName,
    file: {
      fileId: publication.fileId,
      mimeType: null,
      name: input.fileName,
      permalink: null,
      sizeBytes: input.bytes.byteLength,
    },
    joinedChannel: publication.joinedChannel,
    organizationId: input.authorization.activeOrganization.organizationId,
  });
  try {
    await completeCenterAgentPublicationOperation({
      claimId,
      db: input.authorization.db,
      nowMs: Date.now(),
      operationId: claim.operation.id,
      responseJson: JSON.stringify(response),
    });
  } catch (error) {
    await recordCenterAgentPublicationFailure({
      claimId,
      db: input.authorization.db,
      error,
      operation: claim.operation,
      phase: "complete_operation",
      publicationOutcome: "outcome_unknown",
    });
    throw error;
  }
  return response;
}

function parseCompletedSlackFilePublicationResponse(
  responseJson: string | null
): CenterAgentPostSlackFileResponse {
  if (!responseJson) {
    throw new Error(
      "Completed Center Agent file publication is missing its durable response."
    );
  }
  const response = centerAgentPostSlackFileResponseSchema.safeParse(
    JSON.parse(responseJson)
  );
  if (!response.success) {
    throw new Error(
      `failed to replay Center Agent Slack file response: ${response.error.message}`
    );
  }
  return response.data;
}

function parseCompletedPublicationResponse(
  responseJson: string | null
): CenterAgentPostSlackChannelMessageResponse {
  if (!responseJson) {
    throw new Error(
      "Completed Center Agent publication is missing its durable response."
    );
  }
  const response = centerAgentPostSlackChannelMessageResponseSchema.safeParse(
    JSON.parse(responseJson)
  );
  if (!response.success) {
    throw new Error(
      `failed to replay Center Agent Slack channel message response: ${response.error.message}`
    );
  }
  return response.data;
}

async function resolveCenterAgentPublicationSource(input: {
  authorization: CurrentDesignatedCenterAgentAuthorization;
  publicationSource: PublicationSource;
  representedHuman: VerifiedCenterAgentRepresentedMember;
}): Promise<CenterAgentPublicationSource> {
  switch (input.publicationSource.kind) {
    case "organization_document": {
      const document = await createOrganizationDocumentService({
        db: input.authorization.db,
      }).get(
        {
          organizationId: input.authorization.activeOrganization.organizationId,
          role: input.representedHuman.role,
          userId: input.representedHuman.userId,
        },
        input.publicationSource.documentId
      );
      return {
        kind: "organization_document",
        sourceId: document.id,
        sourceRevision: await buildCenterAgentPublicationSourceRevision({
          content: document.content,
          documentId: document.id,
          kind: document.kind,
          title: document.title,
          v: 1,
        }),
      };
    }
    case "remote_agent_execution": {
      const executionId = normalizeOptionalText(
        input.authorization.context.agentControllerConversationId
      );
      if (!executionId || executionId !== input.publicationSource.executionId) {
        throw centerAgentPublicationSourceInvalid(
          "The publication execution does not match the current Center Agent task."
        );
      }
      return {
        kind: "remote_agent_execution",
        sourceId: executionId,
        sourceRevision: await buildCenterAgentPublicationSourceRevision({
          executionId,
          kind: "remote_agent_execution",
          v: 1,
        }),
      };
    }
    case "routine_run": {
      const submissionId = normalizeOptionalText(
        input.authorization.context.agentControllerConversationId
      );
      if (!submissionId) {
        throw centerAgentPublicationSourceInvalid(
          "The Routine publication is not linked to a current Center Agent task."
        );
      }
      const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
        db: input.authorization.db,
        submissionId,
      });
      if (
        !delivery ||
        delivery.organizationId !==
          input.authorization.activeOrganization.organizationId ||
        delivery.profileId !== input.authorization.actorProfileId ||
        delivery.routineRunId !== input.publicationSource.runId
      ) {
        throw centerAgentPublicationSourceInvalid(
          "The publication Routine Run does not match the current Center Agent task."
        );
      }
      const routineRun = await readRoutineRunRecord({
        db: input.authorization.db,
        runId: input.publicationSource.runId,
      });
      const routine =
        routineRun?.organizationId ===
          input.authorization.activeOrganization.organizationId &&
        routineRun.routineId
          ? await readRoutineRecord({
              db: input.authorization.db,
              organizationId: routineRun.organizationId,
              routineId: routineRun.routineId,
            })
          : null;
      if (
        !routine?.authorizedActions.includes("slack.publish_channel_report")
      ) {
        throw centerAgentPublicationSourceInvalid(
          "This Routine is not authorized to publish a Slack channel report."
        );
      }
      return {
        kind: "routine_run",
        sourceId: input.publicationSource.runId,
        sourceRevision: await buildCenterAgentPublicationSourceRevision({
          kind: "routine_run",
          runId: input.publicationSource.runId,
          v: 1,
        }),
      };
    }
    default:
      throw new Error("Unsupported Center Agent publication source.");
  }
}

function centerAgentPublicationSourceInvalid(reason: string): Error {
  return createCoreRpcHttpError({
    code: "center_agent.publication_source_invalid",
    reason,
    status: 409,
  });
}

function buildCenterAgentSlackChannelMessageResponse(input: {
  attribution: CenterAgentPostSlackChannelMessageResponse["attribution"];
  joinedChannel: boolean;
  messageTs: string;
  organizationId: string;
  target: SlackChannelMessageTarget;
}): CenterAgentPostSlackChannelMessageResponse {
  const response: CenterAgentPostSlackChannelMessageResponse = {
    attribution: input.attribution,
    channelName: input.target.channelName,
    joinedChannel: input.joinedChannel,
    messageTs: input.messageTs,
    organizationId: input.organizationId,
  };
  const validated =
    centerAgentPostSlackChannelMessageResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent Slack channel message response: ${validated.error.message}`
    );
  }
  return validated.data;
}

async function recordCenterAgentPublicationFailure(input: {
  claimId: string;
  db: D1Database;
  error: unknown;
  operation: CenterAgentPublicationOperationRecord;
  phase: CenterAgentPublicationFailurePhase;
  publicationOutcome?: "not_published" | "outcome_unknown";
}): Promise<void> {
  const outcome =
    input.publicationOutcome ??
    (input.error instanceof SlackMessagePublicationError &&
    input.error.publicationOutcome === "not_published"
      ? "not_published"
      : "outcome_unknown");
  console.error("[core.center_agent.publication_failed]", {
    destinationId: input.operation.destinationId,
    destinationKind: input.operation.destinationKind,
    errorCode:
      input.error instanceof SlackMessagePublicationError
        ? input.error.errorCode
        : null,
    errorMessage:
      input.error instanceof Error ? input.error.message : String(input.error),
    errorName:
      input.error instanceof Error ? input.error.name : typeof input.error,
    operationId: input.operation.id,
    operationKey: input.operation.operationKey,
    organizationId: input.operation.organizationId,
    outcome,
    phase: input.phase,
    sourceId: input.operation.source.sourceId,
    sourceKind: input.operation.source.kind,
  });
  try {
    await failCenterAgentPublicationOperation({
      claimId: input.claimId,
      db: input.db,
      nowMs: Date.now(),
      operationId: input.operation.id,
      outcome: outcome === "not_published" ? "failed" : "outcome_unknown",
    });
  } catch (transitionError) {
    throw new AggregateError(
      [input.error, transitionError],
      "Center Agent publication failed and its durable outcome could not be recorded."
    );
  }
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
