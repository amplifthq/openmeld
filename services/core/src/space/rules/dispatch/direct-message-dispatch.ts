import type { SignalEnvelope } from "@openmeld/protocol";
import {
  isAgentDirectConversationSpace,
  OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
} from "@openmeld/space";
import type { SpaceMemberRecord } from "../../infrastructure/sql/space-member-repo";
import type { DispatchReadyDecision } from "../mention/mention-dispatch-rules";

export const DIRECT_MESSAGE_AUTO_DISPATCH_RULE_ID =
  "space_direct_message.auto_agent.v1";

export type DirectMessageDispatchReadyDecision = DispatchReadyDecision & {
  directMessagePromptContext: string;
};

export function buildDirectMessageDispatchReadyDecisions(input: {
  activeMemberRecords: readonly SpaceMemberRecord[];
  senderProfileId: string;
  signal: SignalEnvelope;
  spacePurpose: string | null | undefined;
}): DirectMessageDispatchReadyDecision[] {
  if (!isDirectMessageAutoDispatchEligibleSignal(input.signal)) {
    return [];
  }

  const activeHumanMembers = input.activeMemberRecords.filter(
    (memberRecord) => memberRecord.profileKindSnapshot === "human"
  );
  const activeAgentMembers = input.activeMemberRecords.filter(
    (memberRecord) => memberRecord.profileKindSnapshot === "agent"
  );
  if (
    !isAgentDirectConversationSpace({
      activeMemberCount: input.activeMemberRecords.length,
      agentMemberCount: activeAgentMembers.length,
      humanMemberCount: activeHumanMembers.length,
      purpose: input.spacePurpose,
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
      ruleId: DIRECT_MESSAGE_AUTO_DISPATCH_RULE_ID,
      ruleReason: "direct message from human member to agent member",
      directMessagePromptContext: buildDirectMessagePromptContext({
        humanName: humanMember.profileNameSnapshot,
      }),
    },
  ];
}

export function applyDirectMessageDispatchPromptContext(input: {
  sourceText: string;
  decision: DispatchReadyDecision;
}): string {
  const promptContext = readDirectMessagePromptContext(input.decision);
  if (!promptContext) {
    return input.sourceText;
  }
  return `${promptContext}\n\n${input.sourceText}`;
}

export function readDirectMessagePromptContext(
  decision: DispatchReadyDecision
): string | null {
  const promptContext = (
    decision as Partial<DirectMessageDispatchReadyDecision>
  ).directMessagePromptContext;
  return typeof promptContext === "string" && promptContext.trim().length > 0
    ? promptContext.trim()
    : null;
}

function buildDirectMessagePromptContext(input: { humanName: string }): string {
  const humanName = input.humanName.trim() || "the human member";
  return `Direct message context: This is a direct message with ${humanName}. The message is addressed directly to you. Reply directly in this Space; no @mention is needed.`;
}

function isDirectMessageAutoDispatchEligibleSignal(
  signal: SignalEnvelope
): boolean {
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

export { OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE };
