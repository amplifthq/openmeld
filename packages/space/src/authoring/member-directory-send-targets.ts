import type {
  SpaceMemberDirectory,
  SpaceMemberDirectoryEntry,
} from "@openmeld/schemas/types";

export type SpaceMemberDirectorySendTargetEntry = SpaceMemberDirectoryEntry;

export function listSpaceMemberDirectorySendTargets(
  directory: SpaceMemberDirectory
): SpaceMemberDirectorySendTargetEntry[] {
  return [...directory.members];
}
