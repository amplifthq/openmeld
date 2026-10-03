import type { SignalEnvelope } from "@openmeld/protocol";
import { isAutomaticWakeSpace } from "@openmeld/space";
import type { SpaceMemberRecord } from "../../infrastructure/sql/space-member-repo";
import type { DispatchReadyDecision } from "../mention/mention-dispatch-rules";

export const AUTOMATIC_WAKE_DISPATCH_RULE_ID =
  "space_one_human_agent.auto_agent.v1";

export type AutomaticWakeDispatchReadyDecision = DispatchReadyDecision & {
  automaticWakePromptContext: string;
};

export function buildAutomaticWakeDispatchReadyDecisions(input: {
  activeMemberRecords: readonly SpaceMemberRecord[];
  senderProfileId: string;
  signal: SignalEnvelope;
  spacePurpose: string | null | undefined;
  isThreadMessage?: boolean;
  directMessageConvertedAt?: string | null;
}): AutomaticWakeDispatchReadyDecision[] {
  if (!isAutomaticWakeEligibleSignal(input.signal)) {
    return [];
  }

  const activeHumanMembers = input.activeMemberRecords.filter(
    (memberRecord) => memberRecord.profileKindSnapshot === "human"
  );
  const activeAgentMembers = input.activeMemberRecords.filter(
    (memberRecord) => memberRecord.profileKindSnapshot === "agent"
  );
  if (
    !isAutomaticWakeSpace({
      activeMemberCount: input.activeMemberRecords.length,
      agentMemberCount: activeAgentMembers.length,
      humanMemberCount: activeHumanMembers.length,
      purpose: input.spacePurpose,
      isThreadMessage: input.isThreadMessage,
      directMessageConvertedAt: input.directMessageConvertedAt,
    })
  ) {
    return [];
  }

  const humanMember = activeHumanMembers[0];
  const agentMember = activeAgentMembers[0];
  if (!(humanMember && agentMember)) {
    return [];
  }
  if (input.senderProfileId !== humanMember.profileId) {
    return [];
  }
  // Explicit Reference is the member's opt-out from the automatic Wake.
  if (
    input.signal.type === "signal.text" &&
    input.signal.data.messageEnvelope?.referenceTargets.includes(
      agentMember.profileId
    )
  ) {
    return [];
  }

  const sourceEventId = String(input.signal.id ?? "").trim();
  if (!sourceEventId) {
    return [];
  }

  return [
    {
      status: "dispatch_ready",
      dispatchId: crypto.randomUUID(),
      sourceEventId,
      targetProfileId: agentMember.profileId,
      ruleSource: "system",
      ruleId: AUTOMATIC_WAKE_DISPATCH_RULE_ID,
      ruleReason: "message from the only human member to the only agent member",
      automaticWakePromptContext: buildAutomaticWakePromptContext({
        humanName: humanMember.profileNameSnapshot,
      }),
    },
  ];
}

export function applyAutomaticWakeDispatchPromptContext(input: {
  sourceText: string;
  decision: DispatchReadyDecision;
}): string {
  const promptContext = readAutomaticWakePromptContext(input.decision);
  if (!promptContext) {
    return input.sourceText;
  }
  return `${promptContext}\n\n${input.sourceText}`;
}

export function readAutomaticWakePromptContext(
  decision: DispatchReadyDecision
): string | null {
  const promptContext = (
    decision as Partial<AutomaticWakeDispatchReadyDecision>
  ).automaticWakePromptContext;
  return typeof promptContext === "string" && promptContext.trim().length > 0
    ? promptContext.trim()
    : null;
}

function buildAutomaticWakePromptContext(input: { humanName: string }): string {
  const humanName = input.humanName.trim() || "the human member";
  return `Conversation context: This Space has one human, ${humanName}, and one Agent, you. This human message is addressed to you without an @mention. This does not change reply placement. Agent-authored messages never automatically Wake another Agent; use an explicit Wake target to ask another Agent to work.`;
}

function isAutomaticWakeEligibleSignal(signal: SignalEnvelope): boolean {
  if (signal.type !== "signal.text") {
    return false;
  }
  if (signal.profile.kind === "system") {
    return false;
  }

  const meta = toSignalMetaRecord((signal.data as { meta?: unknown }).meta);
  if (meta?.transient === true) {
    return false;
  }
  return true;
}

function toSignalMetaRecord(value: unknown): { transient?: boolean } | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as { transient?: boolean };
}
