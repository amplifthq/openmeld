import { resolveBaseUrl } from "../config/base-url";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { requireOpenMeldProfile } from "../config/resolve-openmeld-profile";
import { sanitizeText } from "../protocol/wire";
import { resolveRuntimeContext } from "../runtime/context";
import { assertDispatchOwnedRuntimePublicWriteAllowed } from "../runtime/dispatch-owned-runtime";
import { formatMessage } from "../runtime/messages";
import { createPresenter } from "../runtime/presenter/index";
import { rethrowSpaceAddressingSnapshotLoadFailure } from "./addressing-preflight";
import { createCliSpaceApi } from "./cli-space-api";
import { assertFullSignalIdArgument } from "./command-context";
import {
  type CliSpaceAddressingTarget,
  prepareCliSpaceComposerSubmission,
} from "./composer-submission-adapter";
import {
  prepareRequestedSpaceSendFiles,
  uploadPreparedSpaceFiles,
} from "./send-files";

export async function runSend(input: {
  contextSelection?: import("@openmeld/schemas/types").ExecutionContextSelection;
  wakeTargets?: readonly string[];
  referenceTargets?: readonly string[];
  mentionTargets?: readonly string[];
  profile?: string;
  baseUrl?: string;
  space: string;
  filePaths?: readonly string[];
  password?: string;
  plainText?: boolean;
  replyToSignalId?: string;
  text: string;
  openMeldProfile?: OpenMeldProfile;
  view?: string;
}) {
  assertDispatchOwnedRuntimePublicWriteAllowed({
    commandLabel: "openmeld space send",
  });
  const hasRecipients = [
    input.wakeTargets,
    input.referenceTargets,
    input.mentionTargets,
  ].some((targets) => Boolean(targets?.length));
  if (input.plainText && hasRecipients) {
    throw new Error(
      "--plain cannot be combined with --wake, --reference, or --mention."
    );
  }

  const runtime = await resolveRuntimeContext({
    profile: input.profile,
    view: input.view,
  });
  const presenter = createPresenter(runtime);

  const openMeldProfile =
    input.openMeldProfile ??
    (await requireOpenMeldProfile({
      openMeldProfileId: input.profile,
      persistSelection: false,
      authAction: "sending a message",
    }));
  const baseUrl = await resolveBaseUrl(input.baseUrl);
  const spaceApi = createCliSpaceApi(baseUrl);
  const space = input.space.trim();

  assertFullSignalIdArgument({
    value: input.replyToSignalId,
    flag: "--reply-to",
    resolvedView: runtime.resolvedView,
  });
  const preparedFiles = await prepareRequestedSpaceSendFiles({
    filePaths: input.filePaths ?? [],
  });

  const owner =
    openMeldProfile.profileKind === "agent"
      ? String(openMeldProfile.ownerUserId ?? "").trim()
      : "";
  const ownerName =
    openMeldProfile.profileKind === "agent"
      ? String(openMeldProfile.ownerName ?? "").trim()
      : "";
  const profileIdentity = {
    kind: openMeldProfile.profileKind,
    profileId: openMeldProfile.openMeldProfileId,
    profileHandle: openMeldProfile.profileHandle,
    profileName: openMeldProfile.profileName,
    ...(owner ? { owner } : {}),
    ...(ownerName ? { ownerName } : {}),
  };

  const text =
    input.text.trim().length === 0 && preparedFiles.length > 0
      ? { ok: true as const, value: "" }
      : sanitizeText(input.text);
  if (!text.ok) {
    throw new Error(text.reason);
  }
  emitAgentSendProgress({
    presenter,
    resolvedView: runtime.resolvedView,
    stage: "prepare_message",
    summary: "Preparing message text and explicit recipients.",
    spaceId: space,
  });
  const { outboundMessageEnvelope, outboundText, resolvedAddressingTargets } =
    await resolveOutboundSubmission({
      wakeTargets: input.wakeTargets,
      referenceTargets: input.referenceTargets,
      mentionTargets: input.mentionTargets,
      openMeldProfile,
      password: input.password,
      plainText: input.plainText === true,
      presenter,
      resolvedView: runtime.resolvedView,
      space,
      spaceApi,
      text: text.value,
    });
  emitSendAddressingSummary({
    outboundMessageEnvelope,
    presenter,
    resolvedAddressingTargets,
    resolvedView: runtime.resolvedView,
  });

  presenter.line({
    code: "send.acting_profile",
    text: `sender: ${profileIdentity.profileId} (${profileIdentity.kind})`,
    data: {
      profileId: profileIdentity.profileId,
      profileKind: profileIdentity.kind,
      profileName: profileIdentity.profileName,
    },
  });

  const requestContext = buildOpenMeldRequestContextFromProfile({
    openMeldProfile,
  });
  emitFileUploadProgress({
    fileCount: preparedFiles.length,
    presenter,
    resolvedView: runtime.resolvedView,
    spaceId: space,
  });
  const files = await uploadPreparedSpaceFiles({
    files: preparedFiles,
    password: input.password,
    requestContext,
    spaceApi,
    spaceId: space,
  });
  const clientMessageId = crypto.randomUUID();
  emitAgentSendProgress({
    presenter,
    resolvedView: runtime.resolvedView,
    stage: "post_message",
    summary: "Posting the Space message through OpenMeld Gateway.",
    spaceId: space,
  });
  const replyToSignalId = String(input.replyToSignalId ?? "").trim();
  const payload = replyToSignalId
    ? await postReplyIntoThread({
        contextSelection: input.contextSelection,
        spaceApi,
        space,
        requestContext,
        password: input.password,
        replyToSignalId,
        outboundText,
        outboundMessageEnvelope,
        clientMessageId,
        files,
      })
    : await spaceApi.postNormalMessage({
        contextSelection: input.contextSelection,
        spaceId: space,
        requestContext,
        ...(input.password === undefined
          ? {}
          : { spacePassword: input.password }),
        text: outboundText,
        ...toSpaceMessageFilesField(files),
        meta: {
          clientMessageId,
        },
        ...(outboundMessageEnvelope
          ? { messageEnvelope: outboundMessageEnvelope }
          : {}),
      });

  presenter.data({
    code: "send.response",
    payload,
  });
  emitSentFileResult({
    fileCount: files.length,
    presenter,
    signalId: payload.id,
  });
  presenter.line({
    code: "send.sent",
    text: formatMessage(runtime.resolvedView, "send.sent"),
  });
}

// Post a reply into the thread rooted at replyToSignalId. Finds the existing
// thread for that root message, or creates one if none exists yet (the CLI is
// otherwise unable to start a thread — only web did before). Reuses the existing
// createThread/postThreadSignal API; backend untouched.
async function postReplyIntoThread(input: {
  contextSelection?: import("@openmeld/schemas/types").ExecutionContextSelection;
  spaceApi: ReturnType<typeof createCliSpaceApi>;
  space: string;
  requestContext: import("@openmeld/schemas/types").OpenMeldRequestContext;
  password?: string;
  replyToSignalId: string;
  outboundText: string;
  outboundMessageEnvelope?: Awaited<
    ReturnType<typeof prepareCliSpaceComposerSubmission>
  >["outboundMessageEnvelope"];
  clientMessageId: string;
  files: Awaited<ReturnType<typeof uploadPreparedSpaceFiles>>;
}) {
  const threadsResponse = await input.spaceApi.listThreads({
    spaceId: input.space,
    requestContext: input.requestContext,
    ...(input.password === undefined ? {} : { spacePassword: input.password }),
  });
  const existingThread = threadsResponse.threads.find(
    (thread) => thread.rootSignalId === input.replyToSignalId
  );
  let threadId = existingThread?.threadId;
  if (!threadId) {
    const created = await input.spaceApi.createThread({
      spaceId: input.space,
      rootSignalId: input.replyToSignalId,
      clientMutationId: crypto.randomUUID(),
      requestContext: input.requestContext,
      ...(input.password === undefined
        ? {}
        : { spacePassword: input.password }),
    });
    threadId = created.thread.threadId;
  }
  const result = await input.spaceApi.postThreadSignal({
    spaceId: input.space,
    threadId,
    requestContext: input.requestContext,
    ...(input.password === undefined ? {} : { spacePassword: input.password }),
    body: {
      contextSelection: input.contextSelection,
      text: input.outboundText,
      clientMessageId: input.clientMessageId,
      ...toSpaceMessageFilesField(input.files),
      ...(input.outboundMessageEnvelope
        ? { messageEnvelope: input.outboundMessageEnvelope }
        : {}),
    },
  });
  return result.signal;
}

async function resolveOutboundSubmission(input: {
  wakeTargets?: readonly string[];
  referenceTargets?: readonly string[];
  mentionTargets?: readonly string[];
  openMeldProfile: OpenMeldProfile;
  password?: string;
  plainText: boolean;
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  space: string;
  spaceApi: ReturnType<typeof createCliSpaceApi>;
  text: string;
}): Promise<{
  outboundMessageEnvelope?: Awaited<
    ReturnType<typeof prepareCliSpaceComposerSubmission>
  >["outboundMessageEnvelope"];
  outboundText: string;
  resolvedAddressingTargets: readonly CliSpaceAddressingTarget[];
}> {
  const preparedSubmission = await prepareCliSpaceComposerSubmission({
    wakeTargets: input.wakeTargets,
    referenceTargets: input.referenceTargets,
    mentionTargets: input.mentionTargets,
    missingSnapshotMessage:
      "Cannot validate recipients because current Space members could not be loaded.",
    onSnapshotLoadFailure: (error) => {
      rethrowSpaceAddressingSnapshotLoadFailure(error);
    },
    loadMembersSnapshot: async () => {
      emitAgentSendProgress({
        presenter: input.presenter,
        resolvedView: input.resolvedView,
        stage: "load_members",
        summary: "Loading current Space members to validate recipients.",
        spaceId: input.space,
      });
      const requestContext = buildOpenMeldRequestContextFromProfile({
        openMeldProfile: input.openMeldProfile,
      });
      return await input.spaceApi.getMembersSnapshot({
        requestContext,
        spaceId: input.space,
        ...(input.password === undefined
          ? {}
          : { spacePassword: input.password }),
      });
    },
    text: input.text,
  });
  return {
    outboundMessageEnvelope: preparedSubmission.outboundMessageEnvelope,
    outboundText: preparedSubmission.outboundText,
    resolvedAddressingTargets: preparedSubmission.resolvedAddressingTargets,
  };
}

function emitSendAddressingSummary(input: {
  outboundMessageEnvelope:
    | Awaited<
        ReturnType<typeof prepareCliSpaceComposerSubmission>
      >["outboundMessageEnvelope"]
    | undefined;
  presenter: ReturnType<typeof createPresenter>;
  resolvedAddressingTargets: readonly CliSpaceAddressingTarget[];
  resolvedView: "human" | "agent";
}): void {
  if (input.resolvedView !== "agent") {
    return;
  }
  const envelope = input.outboundMessageEnvelope;
  const wakeCount = envelope?.activationTargets.length ?? 0;
  const referenceCount = envelope?.referenceTargets.length ?? 0;
  const mentionCount = envelope?.mentionTargets?.length ?? 0;
  input.presenter.line({
    code: "space.send.addressing_summary",
    text: `Space Message Addressing: wake=${wakeCount}, reference=${referenceCount}, mention=${mentionCount}.`,
    data: {
      mentionTargetCount: mentionCount,
      referenceTargetCount: referenceCount,
      ...(input.resolvedAddressingTargets.length > 0
        ? { targets: input.resolvedAddressingTargets }
        : {}),
      wakeTargetCount: wakeCount,
    },
  });
}

function emitAgentSendProgress(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  stage: "prepare_message" | "load_members" | "upload_files" | "post_message";
  summary: string;
  spaceId: string;
}): void {
  if (input.resolvedView !== "agent") {
    return;
  }
  input.presenter.line({
    code: "send.progress",
    text: `${input.stage}: ${input.summary}`,
    data: {
      spaceId: input.spaceId,
      stage: input.stage,
    },
  });
}

function emitFileUploadProgress(input: {
  fileCount: number;
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  spaceId: string;
}): void {
  if (input.fileCount === 0) {
    return;
  }
  emitAgentSendProgress({
    presenter: input.presenter,
    resolvedView: input.resolvedView,
    stage: "upload_files",
    summary: `Adding ${input.fileCount} file${input.fileCount === 1 ? "" : "s"} to this Space before sending the message.`,
    spaceId: input.spaceId,
  });
}

function toSpaceMessageFilesField(
  files: Awaited<ReturnType<typeof uploadPreparedSpaceFiles>>
):
  | {
      files: Awaited<ReturnType<typeof uploadPreparedSpaceFiles>>[number][];
    }
  | Record<string, never> {
  return files.length > 0 ? { files: [...files] } : {};
}

function emitSentFileResult(input: {
  fileCount: number;
  presenter: ReturnType<typeof createPresenter>;
  signalId: string;
}): void {
  if (input.fileCount === 0) {
    return;
  }
  input.presenter.line({
    code: "send.files_sent",
    text: `Sent Space message ${input.signalId} with ${input.fileCount} file${input.fileCount === 1 ? "" : "s"}.`,
    data: {
      fileCount: input.fileCount,
      signalId: input.signalId,
    },
  });
}
