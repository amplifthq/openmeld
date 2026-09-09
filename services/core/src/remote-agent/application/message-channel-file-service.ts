import {
  centerAgentReadChannelFileBodySchema,
  centerAgentReadChannelFileResponseSchema,
  MESSAGE_CHANNEL_FILE_MAX_SIZE_BYTES,
  resolveSpaceFileMimeType,
  spaceAttachmentFileNameSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentReadChannelFileBody,
  CenterAgentReadChannelFileResponse,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import { writeCenterAgentAuditEntry } from "../../center-agent/center-agent-audit";
import { requireCurrentDesignatedCenterAgentCaller } from "../../center-agent/current-designated-center-agent";
import {
  type CoreBindings,
  localStateDb,
  wakeEvidenceDb,
} from "../../lib/bindings";
import { createCoreRpcHttpError } from "../../rpc/errors";
import { readRemoteAgentLarkPlatformChannelConnection } from "../infrastructure/d1/lark-platform-channel-connection-repo";
import { readRemoteAgentNativeDeliveryByDispatchAndConversation } from "../infrastructure/d1/native-delivery-ledger-repo";
import { createLarkPlatformMessageChannelAdapter } from "./lark-platform-message-channel-adapter";

export type CenterAgentReadChannelFileInput = CenterAgentReadChannelFileBody & {
  context: OpenMeldRequestContext;
};

export async function rpcCenterAgentReadChannelFile(
  env: CoreBindings,
  input: CenterAgentReadChannelFileInput
): Promise<CenterAgentReadChannelFileResponse> {
  const parsed = centerAgentReadChannelFileBodySchema.safeParse({
    conversationId: input.conversationId,
    fileKey: input.fileKey,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Choose an attachment from the current Feishu or Lark message.",
    });
  }
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: input.context,
    env,
  });
  const db = wakeEvidenceDb(env);
  const connectionDb = localStateDb(env);
  const dispatchId = input.context.agentControllerConversationId;
  if (!(db && connectionDb && dispatchId)) {
    throw denied();
  }
  const delivery = await readRemoteAgentNativeDeliveryByDispatchAndConversation(
    { db, dispatchId, conversationId: parsed.data.conversationId }
  );
  const request = delivery?.workerSubmitRequest;
  const locator = delivery?.messageChannelLocator;
  const trigger = request?.turnEnvelope?.trigger;
  if (
    !(delivery && request && locator) ||
    (locator.provider !== "feishu" && locator.provider !== "lark") ||
    trigger?.source !== "message_channel" ||
    delivery.conversationKind !== "message_channel" ||
    !["submitted", "accepted", "retry_observed"].includes(delivery.status) ||
    delivery.organizationId !==
      authorization.activeOrganization.organizationId ||
    delivery.profileId !== authorization.actorProfileId ||
    request.agentProfileOwnerUserId !==
      authorization.actorProfile.ownerUserId ||
    request.dispatchId !== dispatchId ||
    trigger.conversationId !== parsed.data.conversationId ||
    trigger.connectionId !== locator.connectionId ||
    trigger.provider !== locator.provider
  ) {
    throw denied();
  }
  const resource = trigger.resources?.find(
    (item) => item.fileKey === parsed.data.fileKey
  );
  if (!resource || (resource.type !== "file" && resource.type !== "image")) {
    throw denied();
  }
  const connection = await readRemoteAgentLarkPlatformChannelConnection({
    db: connectionDb,
    connectionId: locator.connectionId,
  });
  if (
    !connection ||
    connection.organizationId !== delivery.organizationId ||
    connection.status !== "connected"
  ) {
    throw denied();
  }
  const adapter = createLarkPlatformMessageChannelAdapter({
    db: connectionDb,
    cryptoKey: env.LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY,
    provider: locator.provider,
  });
  const downloaded = await adapter.downloadResource({
    connection,
    locator,
    maxBytes: MESSAGE_CHANNEL_FILE_MAX_SIZE_BYTES,
    messageId: delivery.triggerMessageId,
    resource,
  });
  if (downloaded.status !== "downloaded") {
    throw createCoreRpcHttpError({
      status: 502,
      code: downloaded.reasonCode,
      reason:
        "The attachment could not be read. Files must be at most 5 MB and still available in this conversation.",
    });
  }
  const fileName = spaceAttachmentFileNameSchema.parse(
    resource.fileName ?? "attachment"
  );
  const declaredMimeType = downloaded.contentType?.split(";")[0]?.trim();
  const response = centerAgentReadChannelFileResponseSchema.parse({
    contentBase64: encodeBytes(downloaded.bytes),
    fileKey: resource.fileKey,
    fileName,
    mimeType: resolveSpaceFileMimeType({
      fileName,
      declaredMimeType:
        declaredMimeType === "application/octet-stream"
          ? null
          : declaredMimeType,
    }),
    provider: locator.provider,
    sizeBytes: downloaded.bytes.byteLength,
  });
  await writeCenterAgentAuditEntry({
    action: "read_channel_file",
    authorization,
    onBehalfOfProfileId: null,
    resource: { id: resource.fileKey, type: `${locator.provider}_file` },
    sourceNativeDeliveryId: delivery.deliveryId,
  });
  return response;
}

function denied(): Error {
  return createCoreRpcHttpError({
    status: 403,
    code: "message_channel.file_evidence_required",
    reason:
      "Only attachments from this admitted Feishu or Lark request can be read.",
  });
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}
