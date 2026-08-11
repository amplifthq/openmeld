import type {
  CenterAgentContextLoadSelectedEntry,
  CenterAgentContextLoadSelection,
  CenterAgentContextManifestMaterialization,
} from "@openmeld/schemas/types";

export type CenterAgentContextLoadReceiptErrorCode =
  | "center_agent.context_load_client_mismatch"
  | "center_agent.context_load_manifest_empty"
  | "center_agent.context_load_selection_duplicate"
  | "center_agent.context_load_selection_invalid";

export class CenterAgentContextLoadReceiptError extends Error {
  readonly code: CenterAgentContextLoadReceiptErrorCode;

  constructor(input: {
    code: CenterAgentContextLoadReceiptErrorCode;
    message: string;
  }) {
    super(input.message);
    this.name = "CenterAgentContextLoadReceiptError";
    this.code = input.code;
  }
}

export function resolveCenterAgentContextLoadSelection(input: {
  manifestClient: string;
  materializations: readonly CenterAgentContextManifestMaterialization[];
  reportedClient: string;
  selection: CenterAgentContextLoadSelection;
}): {
  estimatedTokens: number;
  selectedEntries: CenterAgentContextLoadSelectedEntry[];
} {
  if (input.reportedClient !== input.manifestClient) {
    throw new CenterAgentContextLoadReceiptError({
      code: "center_agent.context_load_client_mismatch",
      message:
        "The Local Agent reporting this context load must match the client that requested the manifest.",
    });
  }
  if (input.materializations.length === 0) {
    throw new CenterAgentContextLoadReceiptError({
      code: "center_agent.context_load_manifest_empty",
      message:
        "This manifest has no materialized messages to load. Request fresh Center Agent context first.",
    });
  }

  const selectedKeys =
    input.selection.kind === "all_manifest_entries"
      ? new Set(input.materializations.map(materializationKey))
      : resolveExplicitSelectionKeys(input.selection.entries);
  const selectedMaterializations = input.materializations.filter((entry) =>
    selectedKeys.has(materializationKey(entry))
  );
  if (selectedMaterializations.length !== selectedKeys.size) {
    throw new CenterAgentContextLoadReceiptError({
      code: "center_agent.context_load_selection_invalid",
      message:
        "Every loaded entry must exactly match a source and materialized content hash from this manifest.",
    });
  }

  return {
    estimatedTokens: selectedMaterializations.reduce(
      (total, entry) => total + entry.estimatedTokens,
      0
    ),
    selectedEntries: selectedMaterializations.map((entry) => ({
      materializedContentHash: entry.materializedContentHash,
      sourceRefId: entry.sourceRef.id,
    })),
  };
}

export function areCenterAgentContextLoadSelectionsEqual(
  left: readonly CenterAgentContextLoadSelectedEntry[],
  right: readonly CenterAgentContextLoadSelectedEntry[]
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.sourceRefId === right[index]?.sourceRefId &&
        entry.materializedContentHash === right[index]?.materializedContentHash
    )
  );
}

function resolveExplicitSelectionKeys(
  entries: readonly CenterAgentContextLoadSelectedEntry[]
): Set<string> {
  const keys = new Set(entries.map(selectedEntryKey));
  if (keys.size !== entries.length) {
    throw new CenterAgentContextLoadReceiptError({
      code: "center_agent.context_load_selection_duplicate",
      message: "Each loaded manifest entry may be reported only once.",
    });
  }
  return keys;
}

function materializationKey(
  entry: CenterAgentContextManifestMaterialization
): string {
  return `${entry.sourceRef.id}\u0000${entry.materializedContentHash}`;
}

function selectedEntryKey(entry: CenterAgentContextLoadSelectedEntry): string {
  return `${entry.sourceRefId}\u0000${entry.materializedContentHash}`;
}
