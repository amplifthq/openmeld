import { createHash } from "node:crypto";
import {
  buildInformationProtectionPromptPlan,
  buildWorkingLanguagePromptPlan,
  parseAgentControllerRef,
  renderInformationProtectionPrompt,
  renderWorkingLanguagePrompt,
} from "@openmeld/agent-runtime";
import {
  buildDispatchReplyContextSummary,
  SPACE_ACTION_CONTEXT_GUIDANCE_LINES,
} from "@openmeld/local-service";
import {
  collectCanonicalMentionTextFragments,
  resolveSingleSpaceMentionLabels,
} from "@openmeld/schemas";
import type {
  OpenMeldDaemonDispatchContinuitySnapshot,
  OpenMeldDaemonDispatchDeliveryRecoveryReason,
  OpenMeldDaemonDispatchReplyToSnapshot,
  RuntimeCoordinatorExecutionTokenEcho,
  RuntimeTransportDeliverDispatchPayload,
  RuntimeTransportDeliverDispatchRequest,
  SpaceContract,
} from "@openmeld/schemas/types";
import {
  buildAgentFacingMentalModelLines,
  buildCenterAgentRoleTemplateText,
  buildCompactDispatchActionGuidanceLines,
  buildSpaceEntryBriefNeedMoreLine,
  composeDispatchBrief,
  deriveContinuity,
  renderSpaceEntryBrief,
  resolveSpacePublicationRequirement,
} from "@openmeld/space-mesh";
import { createDefaultRuntimeAgentControllerSettings } from "../../config/runtime-config";
import {
  isLocalSpaceStateCorruptResult,
  readSpaceConfig,
  toLocalSpaceStateIntegrityError,
} from "../../space/local-state";
import {
  projectSpaceFacts,
  projectSpaceProfileCache,
} from "../../space/local-state-projection";
import { BOOTSTRAP_INJECTION_KEY_SEPARATOR } from "../core/constants";
import {
  normalizeNonNegativeInteger,
  normalizeOptionalText,
  normalizeText,
} from "../core/logger";
import type {
  DispatchCorrelation,
  DispatchPromptBootstrapInput,
  DispatchTaskParseInput,
  ParsedDispatchTask,
} from "../core/types";

const OPENMELD_SPACE_DEFINITION = buildAgentFacingMentalModelLines()
  .slice(0, 2)
  .join(" ");
const ENTRY_BRIEF_TEMPLATE_VERSION = "space-mesh-entry-brief-v2" as const;
export const COMPACT_DISPATCH_BOOTSTRAP_TEMPLATE_VERSION =
  ENTRY_BRIEF_TEMPLATE_VERSION;
const LOCAL_AGENT_INSTRUCTION_CONTRACT_VERSION =
  "openmeld-native-instructions-v1" as const;

export type DispatchPromptPlan = {
  developerInstructions: string;
  fallbackPrompt: string;
  instructionEpoch: string;
  userPrompt: string;
};

type DispatchTaskRequiredFields = {
  attemptId: string;
  dispatchId: string;
  sourceEventId: string;
  spaceId: string;
  targetProfileId: string;
  taskId: string;
};

type DispatchTaskControllerSelection = {
  agentControllerRef: string;
};

export function parseDispatchTask(
  input: DispatchTaskParseInput
): ParsedDispatchTask | null {
  const payload = resolveDispatchTaskPayload(input.deliverRequest);

  const requiredFields = resolveDispatchTaskRequiredFields({
    deliverRequest: input.deliverRequest,
    payload,
  });
  if (!requiredFields) {
    return null;
  }

  const mentionSourceProfileId =
    normalizeOptionalText(payload.sourceSignal.profileId) ??
    normalizeOptionalText(payload.sourceSignalSnapshot?.profileId);
  const mentionSourceProfileKind =
    payload.sourceSignal.profileKind ??
    payload.sourceSignalSnapshot?.profileKind ??
    null;
  const mentionSourceProfileMentionLabel =
    normalizeOptionalText(payload.sourceSignal.profileMentionLabel) ??
    normalizeOptionalText(payload.sourceSignalSnapshot?.profileMentionLabel);
  const rawPrompt =
    normalizeOptionalText(payload.sourceSignal.text) ??
    normalizeOptionalText(payload.sourceSignalSnapshot?.text);
  const sourceMessageEnvelope = payload.sourceMessageEnvelope ?? null;
  const prompt = resolveDispatchPrompt({
    rawPrompt,
    sourceMessageEnvelope,
  });
  const targetProfileDisplay =
    resolveDispatchTaskTargetProfileDisplayFacts(payload);
  const spaceContext = resolveDispatchTaskSpaceContext(payload);
  const triggerMode =
    spaceContext.spaceContractSnapshot?.dispatchPolicy.mode ??
    payload.dispatchPolicy;
  const recipientExplicitlyAddressedByActivationTargets =
    isRecipientExplicitlyAddressedByActivationTargets({
      sourceMessageEnvelope,
      targetProfileId: requiredFields.targetProfileId,
    });
  const sequence =
    normalizeNonNegativeInteger(payload.enqueuedAtMs) ?? Date.now();

  const controllerSelection = resolveDispatchTaskControllerSelection({
    fallbackAgentControllerRef:
      input.fallbackRouteConfig?.agentControllerRef ?? null,
    payload,
  });
  if (!(prompt && controllerSelection)) {
    return null;
  }

  const fallbackControllerSettings =
    createDefaultRuntimeAgentControllerSettings(
      controllerSelection.agentControllerRef
    );
  const agentControllerConversationId =
    normalizeOptionalText(payload.agentControllerConversationId) ?? null;
  const deliveryRecoveryReason = resolveDeliveryRecoveryReason(payload);
  const executionTokenEcho = resolveExecutionTokenEcho(payload);
  if (!executionTokenEcho) {
    return null;
  }
  const transportMode =
    payload.transportMode ??
    input.fallbackRouteConfig?.transportMode ??
    fallbackControllerSettings.transportMode;
  const streamingMode =
    payload.streamingMode ??
    input.fallbackRouteConfig?.streamingMode ??
    fallbackControllerSettings.streamingMode;
  const contextIdMappingSpec =
    payload.contextIdMappingSpec ??
    input.fallbackRouteConfig?.contextIdMappingSpec ??
    fallbackControllerSettings.contextIdMappingSpec;

  return {
    ...requiredFields,
    agentControllerConversationId,
    ...resolveDispatchSourceFiles(payload),
    ...controllerSelection,
    deliveryRecoveryReason,
    defaultProjectId: normalizeOptionalText(payload.defaultProjectId) ?? null,
    executionIdentity: payload.executionIdentity,
    executionTokenEcho,
    mentionSourceProfileId,
    mentionSourceProfileKind,
    mentionSourceProfileMentionLabel: mentionSourceProfileMentionLabel ?? null,
    organizationProtectedInformation:
      resolveDispatchTaskOrganizationProtectedInformation(payload),
    workingLanguage: resolveDispatchTaskWorkingLanguage(payload),
    prompt,
    targetProfileIsCenterAgent: payload.targetProfileIsCenterAgent === true,
    replyToSnapshot: spaceContext.replyToSnapshot,
    recipientExplicitlyAddressedByActivationTargets,
    runtimeCoordinatorExecutionId: payload.runtimeCoordinatorExecutionId,
    sequence,
    dispatchTriggerSource: resolveDispatchTriggerSource({
      recipientExplicitlyAddressedByActivationTargets,
      triggerMode,
    }),
    spaceContractSnapshot: spaceContext.spaceContractSnapshot,
    spaceNameSnapshot: spaceContext.spaceNameSnapshot,
    spacePassword: normalizeOptionalText(payload.spacePassword) ?? null,
    sourceMessageEnvelope,
    threadContext: spaceContext.threadContext,
    streamingMode,
    continuitySnapshot: spaceContext.continuitySnapshot,
    transportMode,
    ...targetProfileDisplay,
    triggerMode,
    contextIdMappingSpec,
  };
}

function resolveDispatchSourceFiles(
  payload: RuntimeTransportDeliverDispatchPayload
): Pick<ParsedDispatchTask, "attachments" | "files"> {
  return {
    attachments: payload.sourceSignalSnapshot?.attachments ?? [],
    files: payload.sourceSignalSnapshot?.files ?? [],
  };
}

function resolveDispatchTaskWorkingLanguage(
  payload: RuntimeTransportDeliverDispatchPayload
): ParsedDispatchTask["workingLanguage"] {
  return payload.workingLanguage ?? null;
}

function resolveDispatchTaskOrganizationProtectedInformation(
  payload: RuntimeTransportDeliverDispatchPayload
): string | null {
  return (
    normalizeOptionalText(payload.organizationProtectedInformation) ?? null
  );
}

function resolveDispatchTaskTargetProfileDisplayFacts(
  payload: RuntimeTransportDeliverDispatchPayload
): Pick<ParsedDispatchTask, "targetProfileMentionLabel" | "targetProfileName"> {
  return {
    targetProfileMentionLabel:
      normalizeOptionalText(payload.targetProfileMentionLabel) ?? null,
    targetProfileName: normalizeOptionalText(payload.targetProfileName) ?? null,
  };
}

function resolveDispatchPrompt(input: {
  rawPrompt: string | null;
  sourceMessageEnvelope: ParsedDispatchTask["sourceMessageEnvelope"];
}): string | null {
  const prompt = normalizeOptionalText(input.rawPrompt);
  if (!prompt) {
    return null;
  }
  if ((input.sourceMessageEnvelope?.activationTargets.length ?? 0) === 0) {
    return prompt;
  }

  const wakeMentionFragments = collectCanonicalMentionTextFragments(
    prompt
  ).filter((fragment) => fragment.parsedLiteral?.type === "wake");
  if (wakeMentionFragments.length === 0) {
    return prompt;
  }

  let cursor = 0;
  const parts: string[] = [];
  for (const fragment of wakeMentionFragments) {
    parts.push(prompt.slice(cursor, fragment.start));
    cursor = fragment.end;
  }
  parts.push(prompt.slice(cursor));

  return normalizeOptionalText(parts.join(" ").replace(/\s+/gu, " ")) ?? prompt;
}

function resolveDispatchTaskSpaceContext(
  payload: RuntimeTransportDeliverDispatchPayload
): {
  continuitySnapshot: OpenMeldDaemonDispatchContinuitySnapshot | null;
  replyToSnapshot: OpenMeldDaemonDispatchReplyToSnapshot | null;
  spaceContractSnapshot: SpaceContract | null;
  spaceNameSnapshot: string | null;
  threadContext: ParsedDispatchTask["threadContext"];
} {
  return {
    continuitySnapshot: payload.continuitySnapshot ?? null,
    replyToSnapshot: payload.replyToSnapshot ?? null,
    spaceContractSnapshot: payload.spaceContractSnapshot ?? null,
    spaceNameSnapshot: normalizeOptionalText(payload.spaceNameSnapshot) ?? null,
    threadContext: payload.threadContext ?? null,
  };
}

function resolveDispatchTriggerSource(input: {
  recipientExplicitlyAddressedByActivationTargets: boolean;
  triggerMode: ParsedDispatchTask["triggerMode"];
}): ParsedDispatchTask["dispatchTriggerSource"] {
  if (input.recipientExplicitlyAddressedByActivationTargets) {
    return "activation_targets";
  }
  if (input.triggerMode === "listen_all") {
    return "listen_all";
  }
  return "activation_targets";
}

function isRecipientExplicitlyAddressedByActivationTargets(input: {
  sourceMessageEnvelope: ParsedDispatchTask["sourceMessageEnvelope"];
  targetProfileId: string;
}): boolean {
  const normalizedTargetProfileId = normalizeText(input.targetProfileId);
  if (!normalizedTargetProfileId) {
    return false;
  }
  return (
    input.sourceMessageEnvelope?.activationTargets.includes(
      normalizedTargetProfileId
    ) ?? false
  );
}

function resolveDeliveryRecoveryReason(
  payload: RuntimeTransportDeliverDispatchPayload
): OpenMeldDaemonDispatchDeliveryRecoveryReason | null {
  const normalized = normalizeOptionalText(payload.deliveryRecoveryReason);
  if (normalized === "connection_replaced" || normalized === "route_lost") {
    return normalized;
  }
  return null;
}

function resolveExecutionTokenEcho(
  payload: RuntimeTransportDeliverDispatchPayload
): RuntimeCoordinatorExecutionTokenEcho | null {
  const executionToken = payload.executionToken;
  if (!executionToken) {
    return null;
  }
  return {
    executionToken: executionToken.executionToken,
    runId: executionToken.runId,
    runtimeCoordinatorExecutionId:
      executionToken.executionScope.runtimeCoordinatorExecutionId,
    tokenFingerprint: executionToken.tokenFingerprint,
  };
}

function resolveDispatchTaskPayload(
  request: RuntimeTransportDeliverDispatchRequest
) {
  return request.payload;
}

function resolveDispatchTaskRequiredFields(input: {
  deliverRequest: RuntimeTransportDeliverDispatchRequest;
  payload: RuntimeTransportDeliverDispatchPayload;
}): DispatchTaskRequiredFields | null {
  const dispatchId =
    normalizeOptionalText(input.payload.dispatchId) ??
    input.deliverRequest.dispatchId;
  const attemptId =
    normalizeOptionalText(input.payload.attemptId) ??
    normalizeOptionalText(input.deliverRequest.attemptId);
  const taskId = normalizeOptionalText(input.payload.taskId);
  const sourceEventId = normalizeOptionalText(input.payload.sourceEventId);
  const spaceId = normalizeOptionalText(input.payload.spaceId);
  const targetProfileId =
    normalizeOptionalText(input.payload.targetProfileId) ??
    normalizeOptionalText(input.deliverRequest.profileId);
  if (
    !(
      attemptId &&
      dispatchId &&
      taskId &&
      sourceEventId &&
      spaceId &&
      targetProfileId
    )
  ) {
    return null;
  }
  return {
    attemptId,
    dispatchId,
    sourceEventId,
    spaceId,
    targetProfileId,
    taskId,
  };
}

function resolveDispatchTaskControllerSelection(input: {
  fallbackAgentControllerRef: string | null;
  payload: RuntimeTransportDeliverDispatchPayload;
}): DispatchTaskControllerSelection | null {
  const agentControllerRef =
    normalizeOptionalText(
      input.payload.controllerSnapshot.agentControllerRef
    ) ?? input.fallbackAgentControllerRef;
  const parsedAgentControllerRef = parseAgentControllerRef(agentControllerRef);
  if (!parsedAgentControllerRef) {
    return null;
  }
  return {
    agentControllerRef: parsedAgentControllerRef.ref,
  };
}

export function buildDispatchPromptWithBootstrap(
  input: DispatchPromptBootstrapInput
): string {
  return renderDispatchPrompt({
    informationProtectionPrompt: renderInformationProtectionPrompt({
      organizationProtectedInformation:
        input.organizationProtectedInformation ?? null,
    }),
    workingLanguagePrompt: renderWorkingLanguagePrompt({
      workingLanguage: input.workingLanguage ?? null,
    }),
    input,
  });
}

export function buildDispatchPromptPlan(
  input: DispatchPromptBootstrapInput
): DispatchPromptPlan {
  const informationProtectionPlan = buildInformationProtectionPromptPlan({
    organizationProtectedInformation:
      input.organizationProtectedInformation ?? null,
  });
  const workingLanguagePlan = buildWorkingLanguagePromptPlan({
    workingLanguage: input.workingLanguage ?? null,
  });
  const developerInstructions = [
    "OpenMeld local agent contract:",
    OPENMELD_SPACE_DEFINITION,
    informationProtectionPlan.developerInstructions,
    workingLanguagePlan.developerInstructions,
  ].join("\n\n");
  const contentFingerprint = createHash("sha256")
    .update(developerInstructions, "utf8")
    .digest("hex");

  return {
    developerInstructions,
    fallbackPrompt: buildDispatchPromptWithBootstrap(input),
    instructionEpoch: `${LOCAL_AGENT_INSTRUCTION_CONTRACT_VERSION}:${contentFingerprint}`,
    userPrompt: renderDispatchPrompt({
      informationProtectionPrompt: informationProtectionPlan.perTurnPrompt,
      workingLanguagePrompt: workingLanguagePlan.perTurnPrompt,
      input,
    }),
  };
}

function renderDispatchPrompt(input: {
  informationProtectionPrompt: string | null;
  workingLanguagePrompt: string | null;
  input: DispatchPromptBootstrapInput;
}): string {
  const promptInput = input.input;
  const prompt = normalizeText(promptInput.prompt);
  if (!prompt) {
    return "";
  }

  const sections: string[] = [];
  const activationIntentGate = renderActivationIntentGate(promptInput);
  if (activationIntentGate) {
    sections.push(activationIntentGate);
  }
  if (input.informationProtectionPrompt) {
    sections.push(input.informationProtectionPrompt);
  }
  if (input.workingLanguagePrompt) {
    sections.push(input.workingLanguagePrompt);
  }
  if (promptInput.shouldInjectBootstrap && isEntryBriefEnabled(promptInput)) {
    sections.push(renderEntryBriefSection(promptInput));
  }
  if (
    (promptInput.spaceContractSnapshot?.dispatchBrief ?? "default") !== "none"
  ) {
    sections.push(renderDispatchBriefSection(promptInput));
  }
  const centerAgentRoleSection = renderCenterAgentRoleSection(promptInput);
  if (centerAgentRoleSection) {
    sections.push(centerAgentRoleSection);
  }
  sections.push(["Current Wake message:", prompt].join("\n"));
  if (promptInput.imageAttachmentPromptSection) {
    sections.push(promptInput.imageAttachmentPromptSection);
  }
  const spaceFilesSection = renderSharedSpaceFilesSection(promptInput);
  if (spaceFilesSection) {
    sections.push(spaceFilesSection);
  }
  const completionSection = renderMandatoryCompletionSection(promptInput);
  if (completionSection) {
    sections.push(completionSection);
  }
  return sections.filter(Boolean).join("\n\n");
}

function renderSharedSpaceFilesSection(
  input: DispatchPromptBootstrapInput
): string | null {
  const files = input.spaceFiles ?? [];
  if (files.length === 0) {
    return null;
  }
  const cliEntry = normalizeOptionalText(input.cliEntry) ?? "openmeld";
  return [
    "Files shared with this message (canonical Space Files):",
    ...files.map(
      (file) =>
        `- ${JSON.stringify(file.name)} — fileId=${file.fileId}, revision=${file.revision}, type=${file.mimeType}, size=${file.sizeBytes} bytes.`
    ),
    "- Read or update these through the Space Files tools. The fileId and revision above identify the exact bytes that were sent.",
    `- For text, use \`${cliEntry} space files read ${input.spaceId} <file-id> --revision <revision> --profile ${input.targetProfileId} --view agent\`. For binary files, use \`${cliEntry} space files download ${input.spaceId} <file-id> --revision <revision> --output <path> --profile ${input.targetProfileId} --view agent\`.`,
  ].join("\n");
}

function renderActivationIntentGate(
  input: DispatchPromptBootstrapInput
): string | null {
  const publicationRequirement = resolveSpacePublicationRequirement(
    input.spaceContractSnapshot
  );
  if (!publicationRequirement.allowedActions.includes("stay_silent")) {
    return null;
  }

  return [
    "Activation intent gate:",
    "- Decide from the current Wake message and structured addressing before reading Space history or using any tool. Use one brief pass: assigned, referenced_or_candidate, or ambiguous.",
    `- If you are only named as a candidate, example, alternative, or possible helper while another Agent owns the request, call the Space Action \`stay_silent\` tool with reason \`activation_intent.referenced_or_candidate\`; if unavailable, run \`${buildSpaceActionCommand(
      input,
      'silent --reason "activation_intent.referenced_or_candidate"'
    )}\`. Stop before reading history, calling business tools, or publishing an explanation.`,
    "- An explicit Wake target does not by itself prove that the words assign work to you. If the message directly assigns you work, continue. When the intent remains ambiguous, honor the explicit Wake and continue; never rewrite the user's structured targets.",
  ].join("\n");
}

function renderCenterAgentRoleSection(
  input: DispatchPromptBootstrapInput
): string | null {
  if (input.shouldInjectCenterAgentRoleTemplate !== true) {
    return null;
  }
  return ["Center Agent Role:", buildCenterAgentRoleTemplateText()].join("\n");
}

export function buildDispatchBootstrapTemplateFacts(
  input: Omit<DispatchPromptBootstrapInput, "prompt" | "shouldInjectBootstrap">
): {
  contentFingerprint: string;
  templateVersion: typeof COMPACT_DISPATCH_BOOTSTRAP_TEMPLATE_VERSION;
} {
  const contentFingerprint = createHash("sha256")
    .update(
      isEntryBriefEnabled(input) ? renderEntryBriefSection(input) : "",
      "utf8"
    )
    .digest("hex");

  return {
    contentFingerprint,
    templateVersion: COMPACT_DISPATCH_BOOTSTRAP_TEMPLATE_VERSION,
  };
}

export function buildBootstrapInjectionKey(input: {
  spaceId: string;
  targetProfileId: string;
}): string {
  return [normalizeText(input.spaceId), normalizeText(input.targetProfileId)]
    .map((value) => encodeURIComponent(value))
    .join(BOOTSTRAP_INJECTION_KEY_SEPARATOR);
}

function renderEntryBriefSection(
  input: Omit<DispatchPromptBootstrapInput, "prompt" | "shouldInjectBootstrap">
): string {
  return renderSpaceEntryBrief({
    needMore: buildSpaceEntryBriefNeedMoreLine({
      cliEntry: input.cliEntry,
      spaceId: input.spaceId,
    }),
    spaceGuide: input.spaceGuide,
    thisSpace: buildThisSpaceLine(input),
    whatThisSpaceIs: OPENMELD_SPACE_DEFINITION,
    youAre: buildTargetProfileIdentityLine({
      targetProfileId: input.targetProfileId,
      targetProfileName: input.targetProfileName,
      targetProfileMentionLabel: input.targetProfileMentionLabel,
      targetProfileRole: input.targetProfileRole,
    }),
  });
}

function isEntryBriefEnabled(input: {
  spaceContractSnapshot?: DispatchPromptBootstrapInput["spaceContractSnapshot"];
}): boolean {
  return (input.spaceContractSnapshot?.entryBrief ?? "default") !== "none";
}

function renderDispatchBriefSection(
  input: DispatchPromptBootstrapInput
): string {
  const dispatchBrief = composeDispatchBrief({
    activatedBy: buildActivatedByLine(input),
    sourceMessage: buildSourceMessageLine(input.prompt),
    replyTarget: buildReplyTargetLine({
      replyToSnapshot: input.replyToSnapshot,
      threadContext: input.threadContext ?? null,
    }),
    continuity: deriveContinuity({
      messagesSinceThen: input.continuitySnapshot?.messagesSinceThen ?? 0,
      higherAuthorityUpdateCount: input.continuitySnapshot
        ?.higherAuthorityUpdates
        ? 1
        : 0,
    }),
    whatYouCanDoNow: buildWhatYouCanDoNowLine(input),
  });

  const lines = [
    "Space Dispatch Brief:",
    `- Activated by: ${dispatchBrief.activatedBy}`,
    `- Dispatch trigger: ${buildDispatchTriggerLine(input)}`,
    ...buildCurrentWakeContextLines(input),
    shouldRenderReplyTargetLine(dispatchBrief.replyTarget)
      ? `- Reply target: ${dispatchBrief.replyTarget}`
      : null,
    renderContinuityLine({
      ...dispatchBrief.continuity,
      cliEntry: input.cliEntry,
      sourceSignalId: input.sourceSignalId,
      spaceId: input.spaceId,
    }),
    `- Actions: ${dispatchBrief.whatYouCanDoNow}`,
    ...buildProgressiveContextGuidanceLines(input),
    ...buildActionGuidanceLines(input),
    ...buildServiceFreshnessWarningLines(input),
    ...buildSendTargetReferenceLines(input),
  ];

  return lines.filter(Boolean).join("\n");
}

function buildCurrentWakeContextLines(
  input: DispatchPromptBootstrapInput
): string[] {
  const targetProfileIds = (
    input.sourceMessageEnvelope?.activationTargets ?? []
  )
    .map((profileId) => profileId.trim())
    .filter(Boolean);
  const targetCount = targetProfileIds.length;
  const sourceSignalId = normalizeOptionalText(input.sourceSignalId);
  if (targetCount <= 1 || !sourceSignalId) {
    return [];
  }

  const cliEntry = normalizeOptionalText(input.cliEntry) ?? "openmeld";
  const spaceId = normalizeOptionalText(input.spaceId) ?? "<space-id>";
  const updatesCommand = `${cliEntry} space updates ${spaceId} --after-signal ${sourceSignalId} --view agent --json`;
  return [
    `- Current Wake: ${String(targetCount)} Agent Profiles were activated by this source message, including you. Exact participant profile IDs: ${JSON.stringify(targetProfileIds)}. Activation is not evidence that any Agent has contributed.`,
    `- Current Wake outcomes: run \`${updatesCommand}\` only if your final reply depends on another participant's current outcome. It reports exact replies, failures, stopped outcomes, and silent outcomes for this source message.`,
  ];
}

function renderMandatoryCompletionSection(
  input: DispatchPromptBootstrapInput
): string | null {
  const publicationRequirement = resolveSpacePublicationRequirement(
    input.spaceContractSnapshot
  );
  if (publicationRequirement.allowsRawReplyWithoutAction) {
    return null;
  }

  return [
    "Mandatory completion:",
    "- Plain text stays local; it is never a public Space reply.",
    buildMandatoryCompletionActionLine(input, publicationRequirement),
    "- Stop after one action is recorded; that action is the public outcome.",
    "- If neither path can record it, stop. Do not substitute prose or JSON.",
  ].join("\n");
}

function buildMandatoryCompletionActionLine(
  input: Pick<DispatchPromptBootstrapInput, "cliEntry">,
  publicationRequirement: ReturnType<typeof resolveSpacePublicationRequirement>
): string {
  if (publicationRequirement.allowedActions.includes("post_message")) {
    return `- Normal completion: call Space Action \`reply\` with your exact public message. CLI fallback if unavailable: \`${buildSpaceActionCommand(
      input,
      'reply "your public message"'
    )}\` and wait for it to finish.`;
  }
  if (publicationRequirement.allowedActions.includes("post_status")) {
    return `- Normal completion: call Space Action \`status\` with a final-safe status and short update. CLI fallback if unavailable: \`${buildSpaceActionCommand(
      input,
      'status done "short completion update"'
    )}\` and wait for it to finish.`;
  }
  if (publicationRequirement.allowedActions.includes("stay_silent")) {
    return `- Normal completion: call Space Action \`stay_silent\` with your reason. CLI fallback if unavailable: \`${buildSpaceActionCommand(
      input,
      'silent --reason "reason"'
    )}\` and wait for it to finish.`;
  }
  return "- No permitted OpenMeld Space action is available. Do not invent one in answer text.";
}

function buildServiceFreshnessWarningLines(
  input: Pick<DispatchPromptBootstrapInput, "serviceFreshnessWarningLines">
): string[] {
  return input.serviceFreshnessWarningLines?.filter(Boolean) ?? [];
}

function buildTargetProfileIdentityLine(input: {
  targetProfileId: string;
  targetProfileName?: string | null;
  targetProfileMentionLabel?: string | null;
  targetProfileRole?: string | null;
}): string {
  const profileName =
    normalizeOptionalText(input.targetProfileName) ??
    normalizeOptionalText(input.targetProfileMentionLabel) ??
    "unknown";
  const role = normalizeOptionalText(input.targetProfileRole);
  const identityParts = [
    profileName,
    `Profile ID: ${normalizeText(input.targetProfileId) || "unknown"}`,
  ];
  if (role) {
    identityParts.push(`Role: ${role}`);
  }
  return identityParts.join(", ");
}

function buildThisSpaceLine(
  input: Omit<DispatchPromptBootstrapInput, "prompt" | "shouldInjectBootstrap">
): string | null {
  const spaceName = normalizeOptionalText(input.spaceName);
  const spacePurpose = normalizeOptionalText(input.spacePurpose);
  if (spaceName && spacePurpose) {
    return `"${spaceName}" — ${spacePurpose}`;
  }
  if (spacePurpose) {
    return spacePurpose;
  }
  if (spaceName) {
    return `"${spaceName}"`;
  }
  return null;
}

function buildWhatYouCanDoNowLine(
  input: Omit<DispatchPromptBootstrapInput, "prompt" | "shouldInjectBootstrap">
): string {
  const publicationRequirement = resolveSpacePublicationRequirement(
    input.spaceContractSnapshot
  );
  return buildCompactDispatchActionGuidanceLines({
    allowedActions: publicationRequirement.allowedActions,
    allowsRawReplyWithoutAction:
      publicationRequirement.allowsRawReplyWithoutAction,
  })[0];
}

function buildActionGuidanceLines(
  input: Omit<DispatchPromptBootstrapInput, "prompt" | "shouldInjectBootstrap">
): string[] {
  const publicationRequirement = resolveSpacePublicationRequirement(
    input.spaceContractSnapshot
  );
  const compactGuidanceLines = buildCompactDispatchActionGuidanceLines({
    allowedActions: publicationRequirement.allowedActions,
    allowsRawReplyWithoutAction:
      publicationRequirement.allowsRawReplyWithoutAction,
  });
  return [
    ...compactGuidanceLines.slice(1).map((line) => `- ${line}`),
    ...SPACE_ACTION_CONTEXT_GUIDANCE_LINES,
  ];
}

function buildSpaceActionCommand(
  input: Pick<DispatchPromptBootstrapInput, "cliEntry">,
  action: string
): string {
  const cliEntry = normalizeOptionalText(input.cliEntry) ?? "openmeld";
  return `${cliEntry} space action ${action}`;
}

function buildSendTargetReferenceLines(
  input: Pick<DispatchPromptBootstrapInput, "sendTargetReferenceLines">
): string[] {
  if (
    !(
      input.sendTargetReferenceLines &&
      input.sendTargetReferenceLines.length > 0
    )
  ) {
    return [];
  }

  return [
    "- Send target reference:",
    ...input.sendTargetReferenceLines.map((line) => `  ${line}`),
  ];
}

function buildSpaceHistoryCommand(input: {
  cliEntry?: string | null;
  spaceId: string;
}): string {
  const cliEntry = normalizeOptionalText(input.cliEntry) ?? "openmeld";
  const normalizedSpaceId = normalizeOptionalText(input.spaceId);
  return normalizedSpaceId
    ? `${cliEntry} space history ${normalizedSpaceId} --kind text --limit 20`
    : `${cliEntry} space history <space-id> --kind text --limit 20`;
}

function buildSpaceThreadCommand(
  input: Pick<DispatchPromptBootstrapInput, "cliEntry" | "spaceId"> & {
    threadId: string;
  }
): string {
  const cliEntry = normalizeOptionalText(input.cliEntry) ?? "openmeld";
  const spaceId = normalizeOptionalText(input.spaceId) ?? "<space-id>";
  return `${cliEntry} space thread ${spaceId} ${input.threadId} --view agent`;
}

function buildSpaceContextWindowCommand(input: {
  cliEntry?: string | null;
  sourceSignalId: string;
  spaceId: string;
}): string {
  const cliEntry = normalizeOptionalText(input.cliEntry) ?? "openmeld";
  return `${cliEntry} space history ${input.spaceId} --around-signal ${input.sourceSignalId} --before 20 --after 0 --kind text`;
}

function buildProgressiveContextGuidanceLines(
  input: DispatchPromptBootstrapInput
): string[] {
  const lines: string[] = [];
  if (input.threadContext?.threadId) {
    lines.push(
      `- Exact thread context: run \`${buildSpaceThreadCommand({
        cliEntry: input.cliEntry,
        spaceId: input.spaceId,
        threadId: input.threadContext.threadId,
      })}\` only if the provided reply context is insufficient.`
    );
  }
  return lines;
}

function buildActivatedByLine(input: DispatchPromptBootstrapInput): string {
  const mentionSourceProfileName = normalizeOptionalText(
    input.mentionSourceProfileName
  );
  if (mentionSourceProfileName) {
    return mentionSourceProfileName;
  }
  const mentionSourceProfileId = normalizeOptionalText(
    input.mentionSourceProfileId
  );
  if (mentionSourceProfileId) {
    return mentionSourceProfileId;
  }
  return "system";
}

function buildDispatchTriggerLine(input: DispatchPromptBootstrapInput): string {
  if (input.dispatchTriggerSource === "listen_all") {
    return "listen_all: this Space dispatches public messages to active Agent Profiles.";
  }

  if (readRecipientExplicitlyAddressedByActivationTargets(input)) {
    const targetProfileId = normalizeText(input.targetProfileId) || "unknown";
    return `Wake: this message targeted your Agent Profile (${targetProfileId}).`;
  }

  return "Wake: this message was assigned to you.";
}

function readRecipientExplicitlyAddressedByActivationTargets(
  input: DispatchPromptBootstrapInput
): boolean {
  if (
    typeof input.recipientExplicitlyAddressedByActivationTargets === "boolean"
  ) {
    return input.recipientExplicitlyAddressedByActivationTargets;
  }
  return isRecipientExplicitlyAddressedByActivationTargets({
    sourceMessageEnvelope: input.sourceMessageEnvelope ?? null,
    targetProfileId: input.targetProfileId,
  });
}

function buildSourceMessageLine(prompt: string): string {
  const normalized = normalizeText(prompt).replace(/\s+/gu, " ");
  if (normalized.length <= 220) {
    return normalized;
  }
  return `${normalized.slice(0, 206).trimEnd()}... [truncated]`;
}

function buildReplyTargetLine(input: {
  replyToSnapshot: DispatchPromptBootstrapInput["replyToSnapshot"];
  threadContext: DispatchPromptBootstrapInput["threadContext"];
}): string {
  if (input.threadContext) {
    return "Thread";
  }
  return collapseWhitespace(
    buildDispatchReplyContextSummary(input.replyToSnapshot).summary,
    160
  );
}

function renderContinuityLine(input: {
  cliEntry?: string | null;
  messagesSinceThen: number;
  higherAuthorityUpdates: boolean;
  sourceSignalId?: string | null;
  spaceId: string;
}): string | null {
  const parts: string[] = [];
  if (input.messagesSinceThen > 0) {
    parts.push(
      `${String(input.messagesSinceThen)} new ${
        input.messagesSinceThen === 1 ? "message" : "messages"
      }`
    );
  }
  if (input.higherAuthorityUpdates) {
    parts.push("higher-authority updates: yes");
  }
  if (parts.length === 0) {
    return null;
  }
  const sourceSignalId = normalizeOptionalText(input.sourceSignalId);
  if (!sourceSignalId) {
    return `- Since your last public reply: ${parts.join(
      "; "
    )} (run \`${buildSpaceHistoryCommand(input)}\` for content)`;
  }
  const readCommand = buildSpaceContextWindowCommand({
    cliEntry: input.cliEntry,
    sourceSignalId,
    spaceId: input.spaceId,
  });
  return `- Since your last public reply: ${parts.join(
    "; "
  )} (run \`${readCommand}\` for bounded context)`;
}

function shouldRenderReplyTargetLine(replyTarget: string): boolean {
  return normalizeOptionalText(replyTarget) !== "the current source message";
}

function collapseWhitespace(value: string, maxLength: number): string {
  const normalized = normalizeText(value).replace(/\s+/gu, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

export async function resolveBootstrapSpaceOwnerProfileId(input: {
  spaceId: string;
  targetProfileId: string;
}): Promise<string | null> {
  const spaceConfigResult = await readSpaceConfig({
    openMeldProfileId: input.targetProfileId,
    space: input.spaceId,
  });
  if (spaceConfigResult.kind === "missing") {
    return null;
  }
  if (isLocalSpaceStateCorruptResult(spaceConfigResult)) {
    throw toLocalSpaceStateIntegrityError({
      operation: "reading bootstrap space owner profile context",
      result: spaceConfigResult,
    });
  }
  const spaceFacts = projectSpaceFacts(spaceConfigResult.value);
  if (!spaceFacts.creator || typeof spaceFacts.creator !== "object") {
    return null;
  }
  const creator = spaceFacts.creator as {
    profile?: unknown;
    profileId?: unknown;
  };
  return (
    normalizeOptionalText(
      typeof creator.profile === "string" ? creator.profile : creator.profileId
    ) ?? null
  );
}

export async function resolveBootstrapTargetProfileContext(input: {
  spaceId: string;
  targetProfileId: string;
  preferredMentionLabel?: string | null;
  preferredProfileName?: string | null;
}): Promise<{
  targetProfileMentionLabel: string | null;
  targetProfileName: string | null;
  targetProfileRole: string | null;
}> {
  const preferredMentionLabel =
    normalizeOptionalText(input.preferredMentionLabel) ?? null;
  const preferredProfileName =
    normalizeOptionalText(input.preferredProfileName) ?? null;
  const targetSpaceConfigResult = await readSpaceConfig({
    openMeldProfileId: input.targetProfileId,
    space: input.spaceId,
  });
  if (isLocalSpaceStateCorruptResult(targetSpaceConfigResult)) {
    throw toLocalSpaceStateIntegrityError({
      operation: "reading bootstrap target profile context",
      result: targetSpaceConfigResult,
    });
  }
  const targetProfileCache =
    targetSpaceConfigResult.kind === "ok"
      ? projectSpaceProfileCache(targetSpaceConfigResult.value)
      : null;
  const spaceProfileName =
    normalizeOptionalText(targetProfileCache?.profileName) ?? null;
  const spaceMentionAlias =
    normalizeOptionalText(targetProfileCache?.mentionAlias) ?? null;
  const spaceRole = normalizeOptionalText(targetProfileCache?.role) ?? null;
  const targetProfileName = spaceProfileName ?? preferredProfileName;
  if (spaceProfileName || spaceMentionAlias) {
    return {
      targetProfileMentionLabel:
        preferredMentionLabel ??
        resolvePrimaryMentionLabel({
          mentionAlias: spaceMentionAlias,
          profileId: input.targetProfileId,
          profileName: targetProfileName,
        }),
      targetProfileName,
      targetProfileRole: spaceRole,
    };
  }

  return {
    targetProfileMentionLabel:
      preferredMentionLabel ??
      resolvePrimaryMentionLabel({
        mentionAlias: null,
        profileId: input.targetProfileId,
        profileName: targetProfileName,
      }),
    targetProfileName,
    targetProfileRole: spaceRole,
  };
}

export async function resolveDispatchMentionSourceContext(input: {
  spaceId: string;
  mentionSourceProfileId: string | null;
  preferredMentionLabel?: string | null;
}): Promise<{
  mentionSourceProfileName: string | null;
  mentionSourceMentionLabel: string | null;
}> {
  if (!input.mentionSourceProfileId) {
    return {
      mentionSourceProfileName: null,
      mentionSourceMentionLabel: null,
    };
  }

  const preferredMentionLabel =
    normalizeOptionalText(input.preferredMentionLabel) ?? null;

  const sourceSpaceConfigResult = await readSpaceConfig({
    openMeldProfileId: input.mentionSourceProfileId,
    space: input.spaceId,
  });
  if (isLocalSpaceStateCorruptResult(sourceSpaceConfigResult)) {
    throw toLocalSpaceStateIntegrityError({
      operation: "reading dispatch mention source context",
      result: sourceSpaceConfigResult,
    });
  }
  const sourceProfileCache =
    sourceSpaceConfigResult.kind === "ok"
      ? projectSpaceProfileCache(sourceSpaceConfigResult.value)
      : null;
  const sourceProfileHandle =
    normalizeOptionalText(sourceProfileCache?.profileHandle) ?? null;
  const sourceMentionAlias =
    normalizeOptionalText(sourceProfileCache?.mentionAlias) ?? null;
  if (
    sourceMentionAlias ||
    sourceProfileCache?.profileName ||
    sourceProfileHandle
  ) {
    return {
      mentionSourceProfileName:
        normalizeOptionalText(sourceProfileCache?.profileName) ?? null,
      mentionSourceMentionLabel:
        preferredMentionLabel ??
        resolvePrimaryMentionLabel({
          mentionAlias: sourceMentionAlias,
          profileId: input.mentionSourceProfileId,
          profileName:
            normalizeOptionalText(sourceProfileCache?.profileName) ?? null,
        }),
    };
  }
  return {
    mentionSourceProfileName: null,
    mentionSourceMentionLabel:
      preferredMentionLabel ??
      resolvePrimaryMentionLabel({
        mentionAlias: null,
        profileId: input.mentionSourceProfileId,
        profileName: null,
      }),
  };
}

function resolvePrimaryMentionLabel(input: {
  mentionAlias: string | null;
  profileId: string;
  profileName: string | null;
}): string {
  return resolveSingleSpaceMentionLabels({
    mentionAlias: input.mentionAlias,
    profileId: input.profileId,
    profileName: input.profileName,
  }).primaryMentionLabel;
}

export function buildDispatchCorrelation(input: {
  deliverRequest: RuntimeTransportDeliverDispatchRequest;
  parsedTask: ParsedDispatchTask | null;
}): DispatchCorrelation {
  const payload = input.deliverRequest.payload;
  return {
    attemptId:
      input.parsedTask?.attemptId ??
      normalizeOptionalText(payload.attemptId) ??
      normalizeOptionalText(input.deliverRequest.attemptId) ??
      "unknown-attempt",
    agentControllerRef:
      input.parsedTask?.agentControllerRef ??
      normalizeOptionalText(payload.controllerSnapshot.agentControllerRef),
    dispatchId:
      input.parsedTask?.dispatchId ??
      normalizeOptionalText(payload.dispatchId) ??
      input.deliverRequest.dispatchId,
    sourceEventId:
      input.parsedTask?.sourceEventId ??
      normalizeOptionalText(payload.sourceEventId) ??
      "unknown-source-event",
    targetProfileId:
      input.parsedTask?.targetProfileId ??
      normalizeOptionalText(payload.targetProfileId) ??
      input.deliverRequest.profileId,
    taskId:
      input.parsedTask?.taskId ??
      normalizeOptionalText(payload.taskId) ??
      "unknown-task",
  };
}
