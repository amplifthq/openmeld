import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { buildSpaceAttachmentDownloadPath } from "@openmeld/api-client";
import type { SpaceMessageAttachment } from "@openmeld/schemas/types";
import { resolveRegistryRuntimeAdapterContractByAgentControllerRef } from "../../agents/registry-source";
import { resolveBaseUrl } from "../../config/base-url";
import { buildOpenMeldProfileIdentityRequestHeadersWithAuth } from "../../config/request-headers";
import { fetchSpaceRequestWithTimeout } from "../../space/fetch-with-timeout";

const SAFE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

export type DispatchImageAttachmentFailure = {
  attachment: SpaceMessageAttachment;
  errorCode:
    | "controller_image_input_unsupported"
    | "download_failed"
    | "download_size_mismatch"
    | "download_type_mismatch"
    | "invalid_attachment_id"
    | "invalid_task_id"
    | "write_failed";
  errorMessage: string;
};

export type DispatchImageAttachmentDownload = (input: {
  attachmentId: string;
  spaceId: string;
}) => Promise<Response>;

export type DispatchImageAttachmentPreparation = {
  failures: DispatchImageAttachmentFailure[];
  localPaths: string[];
  promptSection: string | null;
};

export async function downloadDispatchImageAttachment(input: {
  attachmentId: string;
  ownerName: string | null;
  ownerUserId: string;
  spaceId: string;
  spacePassword: string | null;
  targetProfileId: string;
  targetProfileName: string | null;
}): Promise<Response> {
  const baseUrl = await resolveBaseUrl();
  const requestUrl = new URL(
    buildSpaceAttachmentDownloadPath(input.spaceId, input.attachmentId),
    baseUrl
  ).toString();
  const headers = await buildOpenMeldProfileIdentityRequestHeadersWithAuth({
    profileIdentity: {
      openMeldProfileId: input.targetProfileId,
      profileKind: "agent",
      ownerUserId: input.ownerUserId,
      ...(input.ownerName ? { ownerName: input.ownerName } : {}),
      profileName: input.targetProfileName ?? input.targetProfileId,
    },
    requestUrl,
    ...(input.spacePassword ? { spacePassword: input.spacePassword } : {}),
  });
  return await fetchSpaceRequestWithTimeout({
    url: requestUrl,
    operation: "space.attachment.download",
    init: { headers },
  });
}

export async function materializeDispatchImageAttachments(input: {
  agentControllerRef: string;
  attachments: SpaceMessageAttachment[];
  downloadAttachment: DispatchImageAttachmentDownload;
  providerRuntimeWorkingDirectory: string;
  spaceId: string;
  taskId: string;
}): Promise<DispatchImageAttachmentPreparation> {
  if (input.attachments.length === 0) {
    return { failures: [], localPaths: [], promptSection: null };
  }

  // TODO(models.dev): OpenCode currently declares local-file image input
  // statically. Resolve it per selected model once the catalog exposes a
  // stable vision-capability contract.
  const capability = resolveRegistryRuntimeAdapterContractByAgentControllerRef(
    input.agentControllerRef
  )?.capabilityDeclaration.imageInputCapability;
  if (capability !== "local_file_path") {
    return buildPreparationResult({
      failures: input.attachments.map((attachment) => ({
        attachment,
        errorCode: "controller_image_input_unsupported",
        errorMessage: `Agent Controller ${input.agentControllerRef} does not accept local image file paths.`,
      })),
      materialized: [],
    });
  }

  if (!isSafePathSegment(input.taskId)) {
    return buildPreparationResult({
      failures: input.attachments.map((attachment) => ({
        attachment,
        errorCode: "invalid_task_id",
        errorMessage: "The dispatch task ID is not safe for a local path.",
      })),
      materialized: [],
    });
  }

  const attachmentDirectory = join(
    input.providerRuntimeWorkingDirectory,
    ".openmeld",
    "attachments",
    input.taskId
  );
  const failures: DispatchImageAttachmentFailure[] = [];
  const materialized: Array<{
    attachment: SpaceMessageAttachment;
    localPath: string;
  }> = [];

  for (const attachment of input.attachments) {
    if (!isSafePathSegment(attachment.id)) {
      failures.push({
        attachment,
        errorCode: "invalid_attachment_id",
        errorMessage: "The attachment ID is not safe for a local path.",
      });
      continue;
    }

    let response: Response;
    try {
      response = await input.downloadAttachment({
        attachmentId: attachment.id,
        spaceId: input.spaceId,
      });
    } catch (error) {
      failures.push({
        attachment,
        errorCode: "download_failed",
        errorMessage: toErrorMessage(error),
      });
      continue;
    }

    if (!response.ok) {
      failures.push({
        attachment,
        errorCode: "download_failed",
        errorMessage: `Attachment download returned HTTP ${response.status}.`,
      });
      continue;
    }
    const responseMimeType = normalizeMimeType(
      response.headers.get("content-type")
    );
    if (responseMimeType !== attachment.mimeType) {
      failures.push({
        attachment,
        errorCode: "download_type_mismatch",
        errorMessage: `Attachment download returned ${responseMimeType ?? "no content type"}; expected ${attachment.mimeType}.`,
      });
      continue;
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      failures.push({
        attachment,
        errorCode: "download_failed",
        errorMessage: toErrorMessage(error),
      });
      continue;
    }
    if (bytes.byteLength !== attachment.sizeBytes) {
      failures.push({
        attachment,
        errorCode: "download_size_mismatch",
        errorMessage: `Attachment download returned ${bytes.byteLength} bytes; expected ${attachment.sizeBytes}.`,
      });
      continue;
    }

    const localPath = join(
      attachmentDirectory,
      `${attachment.id}${resolveImageExtension(attachment)}`
    );
    try {
      await mkdir(attachmentDirectory, { recursive: true });
      await writeFile(localPath, bytes);
    } catch (error) {
      failures.push({
        attachment,
        errorCode: "write_failed",
        errorMessage: toErrorMessage(error),
      });
      continue;
    }
    materialized.push({ attachment, localPath });
  }

  return buildPreparationResult({ failures, materialized });
}

function buildPreparationResult(input: {
  failures: DispatchImageAttachmentFailure[];
  materialized: Array<{
    attachment: SpaceMessageAttachment;
    localPath: string;
  }>;
}): DispatchImageAttachmentPreparation {
  const sections: string[] = [];
  if (input.materialized.length > 0) {
    sections.push(
      [
        "Attached images (local files):",
        ...input.materialized.map(
          ({ attachment, localPath }) =>
            `- \`${localPath}\` — Space attachment ${formatAttachmentLabel(attachment)} (${attachment.mimeType}).`
        ),
      ].join("\n")
    );
  }
  if (input.failures.length > 0) {
    sections.push(
      [
        `The user attached ${input.failures.length} image(s) but they could not be retrieved.`,
        ...input.failures.map(
          ({ attachment }) =>
            `- Space attachment ${formatAttachmentLabel(attachment)} (${attachment.id}) was unavailable.`
        ),
      ].join("\n")
    );
  }
  return {
    failures: input.failures,
    localPaths: input.materialized.map(({ localPath }) => localPath),
    promptSection: sections.length > 0 ? sections.join("\n\n") : null,
  };
}

function resolveImageExtension(attachment: SpaceMessageAttachment): string {
  const declaredExtension = extname(attachment.fileName ?? "").toLowerCase();
  if (attachment.mimeType === "image/png") {
    return declaredExtension === ".png" ? declaredExtension : ".png";
  }
  if (declaredExtension === ".jpg" || declaredExtension === ".jpeg") {
    return declaredExtension;
  }
  return ".jpg";
}

function formatAttachmentLabel(attachment: SpaceMessageAttachment): string {
  return attachment.fileName
    ? JSON.stringify(attachment.fileName)
    : attachment.id;
}

function isSafePathSegment(value: string): boolean {
  return SAFE_PATH_SEGMENT_PATTERN.test(value);
}

function normalizeMimeType(value: string | null): string | null {
  const normalized = String(value ?? "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  return normalized ? normalized : null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
