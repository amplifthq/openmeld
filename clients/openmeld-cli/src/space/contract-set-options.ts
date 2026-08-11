import type {
  PatchSpaceContractBody,
  SpaceContract,
} from "@openmeld/schemas/types";
import { SPACE_CONTRACT_ALLOWED_ACTION_ORDER } from "@openmeld/space-mesh";

export const SPACE_CONTRACT_DISPATCH_POLICY_VALUES = [
  "mention_only",
  "listen_all",
] as const satisfies readonly NonNullable<
  PatchSpaceContractBody["dispatchPolicy"]
>["mode"][];

export const SPACE_CONTRACT_PUBLICATION_MODE_VALUES = [
  "collaboration",
  "raw_context_sharing",
] as const satisfies readonly NonNullable<
  PatchSpaceContractBody["publicationMode"]
>[];

export const SPACE_PUBLICATION_MODE_CLI_VALUES = [
  "collaboration",
  "transparent",
] as const;

export const SPACE_CONTRACT_ALLOWED_ACTION_VALUES =
  SPACE_CONTRACT_ALLOWED_ACTION_ORDER satisfies readonly SpaceContract["allowedActions"][number][];

export const SPACE_CONTRACT_RESULT_ARCHIVE_MODE_VALUES = [
  "none",
  "space_reply_only",
  "all_final_results",
] as const satisfies readonly NonNullable<
  PatchSpaceContractBody["resultArchivePolicy"]
>["mode"][];

export const SPACE_CONTRACT_BRIEF_MODE_VALUES = [
  "default",
  "none",
] as const satisfies readonly NonNullable<
  PatchSpaceContractBody["entryBrief"]
>[];

export function normalizeAllowedActionsCsv(
  rawValue: string | undefined
): string[] | undefined {
  const normalized = Array.from(
    new Set(
      String(rawValue ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );
  if (normalized.length === 0) {
    return undefined;
  }
  return normalized;
}

export function trimOptionalCliValue(
  value: string | undefined
): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizePublicationModeCliValue(
  value: string | undefined
): PatchSpaceContractBody["publicationMode"] | undefined {
  const normalized = trimOptionalCliValue(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "collaboration") {
    return "collaboration";
  }
  if (normalized === "transparent" || normalized === "raw_context_sharing") {
    return "raw_context_sharing";
  }
  throw new Error("Publication mode must be collaboration or transparent.");
}

export function formatPublicationModeForDisplay(
  value: SpaceContract["publicationMode"]
): (typeof SPACE_PUBLICATION_MODE_CLI_VALUES)[number] {
  return value === "raw_context_sharing" ? "transparent" : value;
}
