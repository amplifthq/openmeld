import type {
  SpaceMemberDirectory,
  SpaceMemberDirectoryEntry,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { buildCommandAuthenticationPromptMessage } from "../auth/command-auth";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { emitCliJsonEnvelope } from "../runtime/cli-json-output";
import { createCliSpaceApi } from "./cli-space-api";
import {
  assertValidSpaceIdTarget,
  prepareAuthenticatedSpaceCommandContext,
  resolveOpenMeldProfileForSpaceCommand,
} from "./command-context";
import {
  emitSpaceMembersAgentOutput,
  emitSpaceMembersHumanOutput,
} from "./members-output";
import { runSpaceReadWithPasswordRetry } from "./password-flow";

const LEADING_MENTION_MARKER_PATTERN = /^@/;

export async function runSpaceMembers(input: {
  profile?: string;
  baseUrl?: string;
  space: string;
  password?: string;
  json: boolean;
  brief?: boolean;
  target?: string;
  view?: string;
  entryChecksHandled?: boolean;
}): Promise<void> {
  const context = await prepareAuthenticatedSpaceCommandContext({
    profile: input.profile,
    baseUrl: input.baseUrl,
    view: input.view,
    promptMessage: buildCommandAuthenticationPromptMessage(
      "reading the Space member directory"
    ),
    entryChecksHandled: input.entryChecksHandled,
  });
  if (context.status === "cancelled") {
    return;
  }

  const { runtime, presenter, interactive, baseUrl } = context;
  assertValidSpaceIdTarget({
    space: input.space,
    resolvedView: runtime.resolvedView,
  });
  const openMeldProfile = await resolveOpenMeldProfileForSpaceCommand({
    openMeldProfileId: input.profile,
    resolvedView: runtime.resolvedView,
    interactive,
  });
  const requestContext = buildOpenMeldRequestContextFromProfile({
    openMeldProfile,
  });
  const spaceApi = createCliSpaceApi(baseUrl);
  const directoryRead = await runSpaceReadWithPasswordRetry({
    initialPassword: input.password,
    interactive: interactive && runtime.resolvedView === "human" && !input.json,
    presenter,
    execute: async (password) => {
      const request = {
        spaceId: input.space,
        requestContext,
        ...(password === undefined ? {} : { spacePassword: password }),
      };
      if (input.brief || input.target) {
        const [directory, snapshot] = await Promise.all([
          spaceApi.getMemberDirectory(request),
          spaceApi.getMembersSnapshot(request),
        ]);
        return { directory, snapshot };
      }
      return {
        directory: await spaceApi.getMemberDirectory(request),
        snapshot: null,
      };
    },
  });
  if (directoryRead.status === "cancelled") {
    return;
  }

  if (input.brief || input.target) {
    const brief = buildSpaceMembersBrief({
      directory: directoryRead.result.directory,
      snapshot: directoryRead.result.snapshot,
      target: input.target,
    });
    if (input.json) {
      emitCliJsonEnvelope({
        schemaVersion: 1,
        type: "space.members.brief",
        ...brief,
      });
      return;
    }
    if (runtime.resolvedView === "agent") {
      presenter.data({ code: "space.members.brief", payload: brief });
      return;
    }
    presenter.line({
      code: "space.members.brief",
      text: brief.members
        .map((member) => formatBriefMemberForHuman(member))
        .join("\n"),
    });
    return;
  }

  if (input.json) {
    emitCliJsonEnvelope({
      schemaVersion: 1,
      type: "space.members",
      ...directoryRead.result.directory,
    });
    return;
  }

  if (runtime.resolvedView === "agent") {
    emitSpaceMembersAgentOutput({
      directory: directoryRead.result.directory,
      presenter,
    });
    return;
  }

  emitSpaceMembersHumanOutput({
    directory: directoryRead.result.directory,
    presenter,
  });
}

function buildSpaceMembersBrief(input: {
  directory: SpaceMemberDirectory;
  snapshot: SpaceMembersSnapshot | null;
  target?: string;
}) {
  const selected = input.target
    ? [resolveUniqueMember(input.directory.members, input.target)]
    : input.directory.members;
  const agentsById = new Map(
    (input.snapshot?.agents ?? []).map((agent) => [agent.profileId, agent])
  );
  return {
    spaceId: input.directory.spaceId,
    generatedAt: input.snapshot?.generatedAt ?? input.directory.generatedAt,
    members: selected.map((member) => {
      const readiness = agentsById.get(member.profileId)?.agentWakeAvailability;
      return {
        profileId: member.profileId,
        displayName: member.displayName,
        profileKind: member.profileKind,
        primaryMentionLabel: member.primaryMentionLabel,
        allowedRelations: member.allowedRelations,
        ...(readiness
          ? {
              wakeAvailability: {
                action: readiness.action,
                phase: readiness.phase,
                reasonCode: readiness.reasonCode,
                status: readiness.status,
                summary: readiness.summary,
              },
              canWakeNow: readiness.status === "available_for_wake",
            }
          : {}),
      };
    }),
  };
}

function resolveUniqueMember(
  members: readonly SpaceMemberDirectoryEntry[],
  target: string
): SpaceMemberDirectoryEntry {
  const normalized = normalizeLookupToken(target);
  const matches = members.filter((member) =>
    [
      member.profileId,
      member.profileIdShort,
      member.displayName,
      member.primaryMentionLabel,
      member.mentionAlias,
      ...member.mentionLabels,
      ...member.lookupTokens,
    ].some((candidate) => normalizeLookupToken(candidate) === normalized)
  );
  if (matches.length === 1 && matches[0]) {
    return matches[0];
  }
  if (matches.length > 1) {
    throw new Error(
      `Space member target ${target} is ambiguous. Use the exact profile ID.`
    );
  }
  throw new Error(`Space member target ${target} was not found in this Space.`);
}

function normalizeLookupToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(LEADING_MENTION_MARKER_PATTERN, "")
    .toLowerCase();
}

function formatBriefMemberForHuman(
  member: ReturnType<typeof buildSpaceMembersBrief>["members"][number]
): string {
  let wake = "human member";
  if (member.profileKind === "agent") {
    wake = member.canWakeNow
      ? "ready to Wake"
      : `not ready to Wake${member.wakeAvailability ? ` (${member.wakeAvailability.status})` : ""}`;
  }
  return `${member.displayName} (${member.profileId}) — @${member.primaryMentionLabel}; ${wake}.`;
}
