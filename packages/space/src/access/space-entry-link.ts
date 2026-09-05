import { spaceEntryTargetSchema } from "@openmeld/schemas";
import type { SpaceEntryTarget } from "@openmeld/schemas/types";

const SPACE_ENTRY_PLACEHOLDER_ORIGIN = "https://openmeld.invalid";

export function buildPublicSpaceEntryPath(target: SpaceEntryTarget): string {
  const parsedTarget = spaceEntryTargetSchema.parse(target);
  const url = new URL(
    `/spaces/${encodeURIComponent(parsedTarget.spaceId)}`,
    SPACE_ENTRY_PLACEHOLDER_ORIGIN
  );
  if (parsedTarget.signalId) {
    url.searchParams.set("signalId", parsedTarget.signalId);
  }
  if (parsedTarget.threadRootSignalId) {
    url.searchParams.set("threadRootSignalId", parsedTarget.threadRootSignalId);
  }
  return `${url.pathname}${url.search}`;
}

export function buildPublicSpaceEntryUrl(input: {
  origin: string | null;
  target: SpaceEntryTarget;
}): string {
  const path = buildPublicSpaceEntryPath(input.target);
  if (!input.origin) {
    return path;
  }
  return new URL(path, input.origin).toString();
}
