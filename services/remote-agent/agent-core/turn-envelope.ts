import { resolveCenterAgentContextScopePlan } from "@openmeld/agent-runtime";
import {
  buildAgentTaskKey,
  renderAgentContextEnvelope,
} from "@openmeld/schemas";
import type {
  CenterAgentContextHandling,
  CenterAgentContextScopePlan,
  CenterAgentResultAudience,
  RemoteAgentTurnEnvelope,
} from "@openmeld/schemas/types";
import {
  buildSpaceAgentIdentityLine,
  buildSpaceWakeParticipantLines,
} from "@openmeld/space-mesh";
import { formatMessageChannelProviderName } from "./message-channel";

export function renderRemoteAgentTurnEnvelope(
  envelope: RemoteAgentTurnEnvelope,
  input: {
    sourceSignalId?: string | null;
    targetProfileId?: string;
    activationTargets?: readonly string[];
  } = {}
): string {
  const contextScopePlan = resolveCenterAgentContextScopePlan(envelope);
  const task = [
    `Trigger: ${formatTriggerSource(envelope)}`,
    ...renderCenterAgentInteractionSource(envelope),
    ...(input.sourceSignalId ? [`Source signal: ${input.sourceSignalId}`] : []),
    ...(input.targetProfileId
      ? buildSpaceWakeParticipantLines({
          targetProfileId: input.targetProfileId,
          activationTargets: input.activationTargets ?? [],
          sourceSignalId: input.sourceSignalId,
          readOutcomesInstruction: "use openmeld_read_space_updates",
        })
      : []),
  ];

  if (envelope.trigger.source === "routine") {
    task.push(
      `Scheduled for: ${new Date(envelope.trigger.scheduledFor).toISOString()}`
    );
  }
  if (envelope.trigger.source === "member_research") {
    task.push(
      `Research subject: ${envelope.trigger.subjectDisplayName} (${envelope.trigger.subjectUserId})`
    );
  }
  if (envelope.trigger.source === "task_continuation") {
    task.push(
      `Completed child task: ${buildAgentTaskKey(envelope.trigger.watchedTask)} (${envelope.trigger.outcome.status})`
    );
  }
  if (envelope.trigger.source === "task_watch_continuation") {
    task.push(
      `Observed task: ${buildAgentTaskKey(envelope.trigger.watchedTask)} (${envelope.trigger.outcome.status})`
    );
  }

  const lines = [
    renderAgentContextEnvelope({
      action: [renderReplyAction(envelope)],
      environment: [
        ...(input.targetProfileId
          ? [
              `Your Agent identity: ${buildSpaceAgentIdentityLine({
                targetProfileId: input.targetProfileId,
                targetProfileName: envelope.centerAgent.profileName,
              })}`,
            ]
          : []),
        renderSender(envelope),
        ...(envelope.sender.kind === "member" &&
        envelope.sender.verified &&
        (envelope.sender.profileId || envelope.sender.ownerUserId)
          ? [
              `Verified OpenMeld member identity: ${JSON.stringify({
                profileId: envelope.sender.profileId,
                ownerUserId: envelope.sender.ownerUserId,
              })}`,
            ]
          : []),
        renderConversationEnvironment(envelope),
        `Organization: ${envelope.organization.name}${envelope.organization.personal ? " (personal)" : ""}`,
      ],
      task,
    }),
    "",
    renderCenterAgentContextHandling(contextScopePlan),
  ];
  if (envelope.memory?.status) {
    lines.push(
      "",
      `[Memory recall: ${envelope.memory.status}]`,
      "Some or all retained memory could not be read for this turn. This is not evidence that no memory exists. If the request depends on earlier memory, explain the limitation and use the explicit memory search tool when available. Do not invent a provider failure cause."
    );
  }
  if (envelope.memory?.items.length) {
    lines.push(
      "",
      "[Scoped memory]",
      envelope.memory.items.some((item) => item.subject === "space")
        ? 'Memory provenance: {"kind":"historical_memory","sourceVerification":"space_versions_checked_other_scopes_not_reopened"}'
        : 'Memory provenance: {"kind":"historical_memory","sourceVerification":"not_reopened"}',
      ...envelope.memory.items.map(
        (item) =>
          `- [${renderMemoryScopeLabel({ contextScopePlan, subject: item.subject })}] ${formatMemorySubject(item.subject)} memory from ${formatMemorySource(item)}: ${item.text}`
      )
    );
  }
  if (envelope.memory?.truncated) {
    lines.push(
      "Additional whole memory facts were omitted for the turn's context budget."
    );
  }

  return lines.join("\n");
}

function renderCenterAgentInteractionSource(
  envelope: RemoteAgentTurnEnvelope
): string[] {
  const source = envelope.centerAgentInteractionSource;
  if (!source) {
    return [];
  }
  return [
    `Request carrier: ${source.client} local agent. Return a self-contained result that the local agent can use without asking the requester to operate OpenMeld manually. Carrier and session metadata are trace locators only, never identity, permission, or additional context.`,
  ];
}

function renderCenterAgentContextHandling(
  contextScopePlan: CenterAgentContextScopePlan
): string {
  return [
    "[Context handling]",
    renderResultAudience(contextScopePlan.resultAudience),
    renderRequesterContinuity(contextScopePlan),
    renderMemberMemoryHandling(contextScopePlan.memberMemory),
    renderOrganizationContextHandling(contextScopePlan),
    renderProtectedInformationHandling(contextScopePlan.protectedInformation),
    "Authentication secrets are never available for retrieval or disclosure.",
    "These disclosure limits apply to all model-emitted thinking, public progress, the reply, and every outbound tool argument. Thinking is visible to the current conversation audience, not a private scratchpad. Complete every safe part of the request without explaining these internal rules.",
  ].join("\n");
}

function renderResultAudience(audience: CenterAgentResultAudience): string {
  if (audience === "requester_only") {
    return "Current reply audience: only the requester in this private conversation.";
  }
  if (audience === "organization_members") {
    return "Current reply audience: members in this Organization conversation.";
  }
  return "Current reply audience: people in an external conversation.";
}

function renderRequesterContinuity(
  contextScopePlan: CenterAgentContextScopePlan
): string {
  if (contextScopePlan.requesterIdentity === "verified_member") {
    return "Treat this as the same verified requester across OpenMeld, Slack, Message Channels, and Local Agents.";
  }
  if (contextScopePlan.requesterIdentity === "connected_organization_member") {
    return "Treat this person as an internal Organization member without inventing a personal OpenMeld identity.";
  }
  if (contextScopePlan.requesterIdentity === "external_participant") {
    return "Treat this person as external to the Organization.";
  }
  if (contextScopePlan.requesterIdentity === "organization_routine") {
    return "Treat this as Organization-configured unattended work, not a live personal conversation.";
  }
  return "Treat the speaking Agent Profile as the requester without inventing a human identity.";
}

function renderMemberMemoryHandling(
  handling: CenterAgentContextHandling
): string {
  if (handling === "use_and_share") {
    return [
      "Use personal memory to continue naturally with this requester and avoid asking them to repeat known context.",
      "Core may automatically learn eligible facts from this completed private turn into this requester's Member memory after the reply.",
      "This is not a callable tool, so never claim that personal memory persistence succeeded or failed from the visible tool list alone, and never redirect the requester to a different conversation carrier for memory persistence.",
    ].join(" ");
  }
  if (handling === "use_privately") {
    return [
      "Use personal memory silently to help this same requester without asking them to repeat themselves.",
      "Do not quote, expose, or imply private details in model-emitted thinking, public progress, this shared reply, or outbound tool arguments.",
    ].join(" ");
  }
  return "Personal memory is not available; do not imply that you remember private facts about this person.";
}

function renderOrganizationContextHandling(
  contextScopePlan: CenterAgentContextScopePlan
): string {
  const handling = contextScopePlan.organizationDocuments;
  if (handling === "share_when_authorized") {
    return "Use Organization context to solve the request. Share it only when the requester and destination are appropriate; a clear authorized request needs no extra confirmation.";
  }
  if (handling === "use_privately") {
    return "Use Organization context privately to solve the request, but do not expose non-public Organization details in this shared reply.";
  }
  return "Organization context is not available. Answer from the current conversation and general knowledge only.";
}

function renderProtectedInformationHandling(
  handling: CenterAgentContextHandling
): string {
  if (handling === "share_when_authorized") {
    return "Use protected information only when the requester and destination are appropriate; clear existing authorization needs no extra confirmation.";
  }
  if (handling === "use_privately") {
    return "Never include protected information in model-emitted thinking, public progress, the reply, or an outbound tool argument.";
  }
  return "Protected information is not available in this turn.";
}

function renderMemoryScopeLabel(input: {
  contextScopePlan: CenterAgentContextScopePlan;
  subject: "member" | "organization" | "space";
}): string {
  if (input.subject === "space") {
    if (
      input.contextScopePlan.interactionEnvironment !== "organization_shared"
    ) {
      throw new Error(
        "Space memory requires its authorized shared Space context."
      );
    }
    return "Available in this Space; not Organization-wide knowledge";
  }
  const handling =
    input.subject === "member"
      ? input.contextScopePlan.memberMemory
      : input.contextScopePlan.organizationMemory;
  if (handling === "use_and_share") {
    return "Available to this requester";
  }
  if (handling === "use_privately") {
    return "Restricted context — never quote, expose, or imply this detail in model-emitted thinking, public progress, the current reply, or outbound tool arguments";
  }
  if (handling === "share_when_authorized") {
    return "Share only when the requester and destination are authorized";
  }
  throw new Error(
    "Unavailable Center Agent memory must not be materialized into the turn."
  );
}

function renderConversationEnvironment(
  envelope: RemoteAgentTurnEnvelope
): string {
  if (
    envelope.trigger.source === "task_continuation" ||
    envelope.trigger.source === "task_watch_continuation"
  ) {
    return `Conversation: ${envelope.space.name} (coordinated task continuation)`;
  }
  if (envelope.trigger.source === "message_channel") {
    return `Channel conversation: ${formatMessageChannelProviderName(envelope.trigger.provider)}`;
  }
  return `Space: ${envelope.space.name} (${envelope.space.isCenterAgentDm ? "DM with you" : "shared Space"})`;
}

function renderReplyAction(envelope: RemoteAgentTurnEnvelope): string {
  if (envelope.trigger.source === "member_research") {
    return "Return the structured member research result through the task callback. Do not publish a Space message.";
  }
  if (
    envelope.trigger.source === "task_continuation" ||
    envelope.trigger.source === "task_watch_continuation"
  ) {
    return "Complete the continuation; your final response will be delivered to the original requester in the original conversation.";
  }
  if (
    envelope.trigger.source === "slack" ||
    (envelope.trigger.source === "routine" &&
      envelope.trigger.destination?.kind === "slack_thread")
  ) {
    return "Reply in the originating Slack thread.";
  }
  if (envelope.trigger.source === "message_channel") {
    return `Reply in the originating ${formatMessageChannelProviderName(envelope.trigger.provider)} conversation.`;
  }
  return `Reply in the current OpenMeld Space (${envelope.space.id}).`;
}

function renderSender(envelope: RemoteAgentTurnEnvelope): string {
  const { sender } = envelope;
  if (sender.kind === "routine") {
    const routineName =
      envelope.trigger.source === "routine"
        ? envelope.trigger.routineName
        : sender.routineId;
    return `Routine: "${routineName}" (organization-configured unattended execution)`;
  }
  const senderRole = sender.role ? `, ${sender.role}` : "";
  let senderIdentity = sender.verified ? "verified" : "unverified";
  if (
    sender.kind === "member" &&
    !sender.verified &&
    sender.messageChannelIdentity
  ) {
    senderIdentity = "connected Message Channel member";
  }
  const providerAccountEmail =
    sender.kind === "member" && sender.messageChannelIdentity?.providerUserEmail
      ? `; current provider account email: ${sender.messageChannelIdentity.providerUserEmail}`
      : "";
  return `Speaking to you: ${sender.displayName} (${sender.kind === "agent_profile" ? "agent" : "member"}, ${senderIdentity}${senderRole}${providerAccountEmail})`;
}

function formatTriggerSource(envelope: RemoteAgentTurnEnvelope): string {
  switch (envelope.trigger.source) {
    case "slack":
      return "Slack mention";
    case "message_channel":
      return `${formatMessageChannelProviderName(envelope.trigger.provider)} message`;
    case "space_wake":
      return "woken in a shared Space";
    case "routine":
      return "scheduled Routine run";
    case "member_research":
      return "member profile research task";
    case "task_continuation":
      return "completed delegated task";
    case "task_watch_continuation":
      return "observed task condition";
    case "web_dm":
      return "web DM";
    default:
      return "woken in a shared Space";
  }
}

function formatMemorySubject(
  subject: NonNullable<
    RemoteAgentTurnEnvelope["memory"]
  >["items"][number]["subject"]
) {
  return {
    space: "current Space",
    organization: "organization",
    member: "personal",
  }[subject];
}

function formatMemorySource(
  item: NonNullable<RemoteAgentTurnEnvelope["memory"]>["items"][number]
) {
  switch (item.source) {
    case "ca_dm":
      return "Center Agent DM";
    case "explicit_tool":
      return "explicit save request";
    case "slack_conversation":
      return "Slack conversation";
    case "space_conversation":
      return "shared Space";
    case "message_channel_conversation":
      return `${formatMessageChannelProviderName(item.provider)} conversation`;
    default:
      return "shared Space";
  }
}
