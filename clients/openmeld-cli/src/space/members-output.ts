import type { SpaceMemberDirectory } from "@openmeld/schemas/types";
import type { Presenter } from "../runtime/presenter";
import { colorizeDisplayProfileLabel } from "../ui/profile-label-color";
import { sanitizeTerminalDisplayText } from "../ui/terminal-safe-text";

export function emitSpaceMembersHumanOutput(input: {
  directory: SpaceMemberDirectory;
  presenter: Presenter;
}): void {
  input.presenter.line({
    code: "space.members.title",
    text: `Space members (${input.directory.members.length}):`,
  });
  for (const member of input.directory.members) {
    const displayName = sanitizeTerminalDisplayText(
      member.displayName,
      "single-line"
    );
    const coloredName = colorizeDisplayProfileLabel({
      label: displayName,
      profileIdentity: {
        profileId: member.profileId,
        profileKind: member.profileKind,
        profileName: member.displayName,
        ownerName: member.ownerName,
        ownerUserId: member.ownerUserId,
      },
    });
    const role = member.spaceRole?.role ?? member.agentCard?.role;
    const identity = role
      ? `${member.profileKind}, ${sanitizeTerminalDisplayText(role, "single-line")}`
      : member.profileKind;
    input.presenter.line({
      code: "space.members.member",
      text: `- ${coloredName} (${identity}) — ${formatMemberAddressing(member)}`,
    });
  }
}

export function emitSpaceMembersAgentOutput(input: {
  directory: SpaceMemberDirectory;
  presenter: Presenter;
}): void {
  input.presenter.data({
    code: "space.members.directory",
    payload: input.directory,
  });
  input.presenter.line({
    code: "space.members.summary",
    text: `Space member directory: ${input.directory.members.length} member${input.directory.members.length === 1 ? "" : "s"}.`,
    data: {
      generatedAt: input.directory.generatedAt,
      memberCount: input.directory.members.length,
      spaceId: input.directory.spaceId,
    },
  });
}

function formatMemberAddressing(
  member: SpaceMemberDirectory["members"][number]
): string {
  const mentionLabel = sanitizeTerminalDisplayText(
    member.primaryMentionLabel,
    "single-line"
  );
  const relations = [
    ...(member.allowedRelations.wake ? [`@${mentionLabel}(wake)`] : []),
    ...(member.allowedRelations.reference
      ? [`@${mentionLabel}(reference)`]
      : []),
  ];
  return relations.length > 0
    ? relations.join(", ")
    : "no message addressing available";
}
