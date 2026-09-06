import { centerAgentOrganizationDirectoryPageSchema } from "@openmeld/schemas";
import type { OrganizationDirectoryResponse } from "@openmeld/schemas/types";
import {
  REMOTE_AGENT_TOOL_RESULT_MAX_BYTES,
  RemoteAgentToolResultTooLargeError,
} from "./tool-result-boundary";

// Leave room for Code Mode's result envelope and bounded logs. This projects
// Core's authorized facts; it does not cache identity or derive readiness.
const PAGE_MAX_BYTES = REMOTE_AGENT_TOOL_RESULT_MAX_BYTES / 2;

export function pageOrganizationDirectory(
  directory: OrganizationDirectoryResponse,
  input: { cursor?: string; limit?: number }
) {
  const entries = [
    ...directory.members.map((value) => ({
      kind: "member" as const,
      value,
      id: value.userId,
    })),
    ...directory.agentProfiles.map((value) => ({
      kind: "agent" as const,
      value,
      id: value.profileId,
    })),
  ].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)
  );
  const cursorFor = (entry: (typeof entries)[number]) =>
    JSON.stringify([directory.organizationId, entry.kind, entry.id]);
  const start =
    input.cursor === undefined
      ? 0
      : entries.findIndex((entry) => cursorFor(entry) === input.cursor) + 1;
  if (input.cursor !== undefined && start === 0) {
    throw new Error(
      "The directory cursor is no longer valid. Restart from the first page."
    );
  }
  const page = {
    organizationId: directory.organizationId,
    generatedAt: directory.generatedAt,
    members: [] as OrganizationDirectoryResponse["members"],
    agentProfiles: [] as OrganizationDirectoryResponse["agentProfiles"],
    totalMembers: directory.members.length,
    totalAgentProfiles: directory.agentProfiles.length,
    nextCursor: null as string | null,
  };
  const end = Math.min(entries.length, start + (input.limit ?? 20));
  for (const [offset, entry] of entries.slice(start, end).entries()) {
    const index = start + offset;
    const previousCursor = page.nextCursor;
    if (entry.kind === "member") {
      page.members.push(entry.value);
    } else {
      page.agentProfiles.push(entry.value);
    }
    page.nextCursor = index + 1 < entries.length ? cursorFor(entry) : null;
    if (
      new TextEncoder().encode(JSON.stringify(page)).byteLength > PAGE_MAX_BYTES
    ) {
      if (entry.kind === "member") {
        page.members.pop();
      } else {
        page.agentProfiles.pop();
      }
      page.nextCursor = previousCursor;
      if (index === start) {
        throw new RemoteAgentToolResultTooLargeError(
          "openmeld_read_organization_directory"
        );
      }
      break;
    }
  }
  return centerAgentOrganizationDirectoryPageSchema.parse(page);
}
