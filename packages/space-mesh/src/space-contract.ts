import type {
  PutSpaceContractBody,
  SpaceContract,
} from "@openmeld/schemas/types";

type SpaceAllowedAction = SpaceContract["allowedActions"][number];

export const SPACE_CONTRACT_ALLOWED_ACTION_ORDER = [
  "post_message",
  "post_status",
  "stay_silent",
] as const satisfies readonly SpaceAllowedAction[];

export const DEFAULT_SPACE_CONTRACT_FIELDS: PutSpaceContractBody = {
  dispatchPolicy: {
    mode: "mention_only",
  },
  publicationMode: "collaboration",
  allowedActions: [...SPACE_CONTRACT_ALLOWED_ACTION_ORDER],
  resultArchivePolicy: {
    mode: "space_reply_only",
  },
  authorityOrder: "default",
  entryBrief: "default",
  dispatchBrief: "default",
};

export function canonicalizeAllowedActions(
  actions: readonly SpaceAllowedAction[]
): SpaceContract["allowedActions"] {
  const allowedActionSet = new Set(actions);
  return SPACE_CONTRACT_ALLOWED_ACTION_ORDER.filter((action) =>
    allowedActionSet.has(action)
  );
}

export function areAllowedActionsEquivalent(
  left: readonly SpaceAllowedAction[],
  right: readonly SpaceAllowedAction[]
): boolean {
  const canonicalLeft = canonicalizeAllowedActions(left);
  const canonicalRight = canonicalizeAllowedActions(right);

  return (
    canonicalLeft.length === canonicalRight.length &&
    canonicalLeft.every((action, index) => action === canonicalRight[index])
  );
}

export function buildDefaultSpaceContract(input?: {
  updatedAt?: string;
  updatedBy?: string;
  version?: number;
}): SpaceContract {
  const updatedAt = input?.updatedAt ?? new Date().toISOString();
  const updatedBy = normalizeUpdatedBy(input?.updatedBy);

  return {
    version: input?.version ?? 1,
    updatedAt,
    updatedBy,
    ...DEFAULT_SPACE_CONTRACT_FIELDS,
  };
}

function normalizeUpdatedBy(value: string | undefined): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : "system";
}
