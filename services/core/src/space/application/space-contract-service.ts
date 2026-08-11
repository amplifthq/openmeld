import {
  patchSpaceContractBodySchema,
  putSpaceContractBodySchema,
} from "@openmeld/schemas";
import type {
  PatchSpaceContractBody,
  PutSpaceContractBody,
  SpaceContract,
} from "@openmeld/schemas/types";
import {
  areAllowedActionsEquivalent,
  buildDefaultSpaceContract,
  canonicalizeAllowedActions,
  DEFAULT_SPACE_CONTRACT_FIELDS,
} from "@openmeld/space-mesh";

type SpaceContractStore = {
  readSpaceContract: () => SpaceContract | null;
  upsertSpaceContract: (contract: SpaceContract) => void;
};

export { buildDefaultSpaceContract, DEFAULT_SPACE_CONTRACT_FIELDS };

export const readOrInitializeSpaceContractUseCase = (input: {
  store: SpaceContractStore;
  nowIso?: string;
  updatedBy?: string;
}): SpaceContract => {
  const contract = readSpaceContractOrDefaultUseCase(input);
  if (input.store.readSpaceContract()) {
    return contract;
  }
  input.store.upsertSpaceContract(contract);
  return contract;
};

export const readSpaceContractOrDefaultUseCase = (input: {
  store: Pick<SpaceContractStore, "readSpaceContract">;
  nowIso?: string;
  updatedBy?: string;
}): SpaceContract => {
  const current = input.store.readSpaceContract();
  if (current) {
    return current;
  }

  return buildDefaultSpaceContract({
    updatedAt: input.nowIso,
    updatedBy: input.updatedBy,
  });
};

export const handlePutSpaceContractUseCase = (input: {
  body: unknown;
  store: SpaceContractStore;
  updatedBy?: string;
  nowIso?: string;
}): Response => {
  return handleSpaceContractWriteUseCase({
    body: input.body,
    schema: putSpaceContractBodySchema,
    store: input.store,
    updatedBy: input.updatedBy,
    nowIso: input.nowIso,
  });
};

export const handlePatchSpaceContractUseCase = (input: {
  body: unknown;
  store: SpaceContractStore;
  updatedBy?: string;
  nowIso?: string;
}): Response => {
  return handleSpaceContractWriteUseCase({
    body: input.body,
    schema: patchSpaceContractBodySchema,
    store: input.store,
    updatedBy: input.updatedBy,
    nowIso: input.nowIso,
  });
};

function normalizeUpdatedBy(value: string | undefined): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : "system";
}

function handleSpaceContractWriteUseCase(input: {
  body: unknown;
  schema:
    | typeof putSpaceContractBodySchema
    | typeof patchSpaceContractBodySchema;
  store: SpaceContractStore;
  updatedBy?: string;
  nowIso?: string;
}): Response {
  const parsed = input.schema.safeParse(input.body);
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        code: "space.contract.invalid_body",
        message:
          parsed.error.issues[0]?.message ?? "space contract body is invalid",
      },
      { status: 400 }
    );
  }

  const current = input.store.readSpaceContract();
  const currentEffectiveContract =
    current ??
    buildDefaultSpaceContract({
      updatedAt: input.nowIso,
    });
  const next = buildNextSpaceContract({
    current,
    patch: parsed.data,
    updatedBy: input.updatedBy,
    nowIso: input.nowIso,
  });
  if (
    areSpaceContractBusinessFieldsEqual({
      left: currentEffectiveContract,
      right: next,
    })
  ) {
    return Response.json(currentEffectiveContract);
  }
  input.store.upsertSpaceContract(next);
  return Response.json(next);
}

function buildNextSpaceContract(input: {
  current: SpaceContract | null;
  patch: PutSpaceContractBody | PatchSpaceContractBody;
  updatedBy?: string;
  nowIso?: string;
}): SpaceContract {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const updatedBy = normalizeUpdatedBy(input.updatedBy);
  const base =
    input.current ??
    buildDefaultSpaceContract({
      updatedAt: nowIso,
      updatedBy,
    });
  const mergedContract = {
    ...base,
    ...input.patch,
  };

  return {
    ...mergedContract,
    allowedActions: canonicalizeAllowedActions(mergedContract.allowedActions),
    version: (input.current?.version ?? 0) + 1,
    updatedAt: nowIso,
    updatedBy,
  };
}

function areSpaceContractBusinessFieldsEqual(input: {
  left: SpaceContract;
  right: SpaceContract;
}): boolean {
  return (
    input.left.dispatchPolicy.mode === input.right.dispatchPolicy.mode &&
    input.left.publicationMode === input.right.publicationMode &&
    areAllowedActionsEquivalent(
      input.left.allowedActions,
      input.right.allowedActions
    ) &&
    input.left.resultArchivePolicy.mode ===
      input.right.resultArchivePolicy.mode &&
    input.left.spaceNote === input.right.spaceNote &&
    input.left.authorityOrder === input.right.authorityOrder &&
    input.left.entryBrief === input.right.entryBrief &&
    input.left.dispatchBrief === input.right.dispatchBrief
  );
}
