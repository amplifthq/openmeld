import type { SignalEnvelope } from "@openmeld/protocol";
import { recordSpaceInboxPersonalAgentContact } from "../infrastructure/sql/space-inbox-contact-repo";
import type { SpaceMemberRecord } from "../infrastructure/sql/space-member-repo";
import { resolveSpaceInboxAgentAddressing } from "./space-inbox-agent-addressing";
import type { SignalPublishContext } from "./types";

export function recordSpaceInboxFirstContacts(input: {
  activeMemberRecords: readonly SpaceMemberRecord[];
  archiveCursorTs: number | null;
  directMessage: boolean;
  organizationId: string;
  signal: SignalEnvelope;
  signalContext?: SignalPublishContext;
  sql: SqlStorage;
}): string[] {
  if (
    input.signal.type !== "signal.text" ||
    input.signal.profile.kind !== "human"
  ) {
    return [];
  }
  const initiatingUserId = input.activeMemberRecords.find(
    (member) =>
      member.status === "active" &&
      member.profileKindSnapshot === "human" &&
      member.profileId === input.signal.profile?.profileId
  )?.ownerUserIdSnapshot;
  if (!initiatingUserId) {
    return [];
  }
  const addressing = resolveSpaceInboxAgentAddressing(input);
  const root = input.signalContext?.threadContext?.rootSignalId ?? null;
  const rootSignal = root
    ? input.sql
        .exec<{ ts: number }>("SELECT ts FROM space_signals WHERE id = ?", root)
        .toArray()[0]
    : null;
  const historyMayBeArchived =
    input.archiveCursorTs !== null &&
    (!rootSignal || rootSignal.ts <= input.archiveCursorTs);
  return input.activeMemberRecords
    .flatMap((agent) => {
      if (
        !agent.ownerUserIdSnapshot ||
        agent.ownerUserIdSnapshot === initiatingUserId ||
        !addressing.initiatingAgentProfileIds.includes(agent.profileId)
      ) {
        return [];
      }
      return recordSpaceInboxPersonalAgentContact(input.sql, {
        organizationId: input.organizationId,
        spaceId: input.signal.spaceId,
        scopeKey: root ? `thread:${root}` : "main",
        threadRootSignalId: root,
        initiatingUserId,
        recipientUserId: agent.ownerUserIdSnapshot,
        agentProfileId: agent.profileId,
        signalId: input.signal.id,
        directMessage: input.directMessage,
        historyMayBeArchived,
      })
        ? [agent.profileId]
        : [];
    })
    .sort();
}
