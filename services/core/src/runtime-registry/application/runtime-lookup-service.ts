import type {
  AuthorityOpenMeldServiceRuntimeId,
  RuntimeLookupInput,
} from "@openmeld/agent-runtime";

export type RuntimeLookupStoreResult =
  | {
      openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
      status: "found";
    }
  | {
      status: "missing";
    }
  | {
      reason: string;
      status: "conflict";
    };

export type RuntimeLookupStore = {
  readRuntimeRecord: (input: {
    runtimeLookupInput: RuntimeLookupInput;
  }) => Promise<RuntimeLookupStoreResult>;
};

export type RuntimeLookupResult =
  | RuntimeLookupStoreResult
  | {
      reason: string;
      status: "invalid_identity";
    };

export async function lookupRuntime(input: {
  runtimeLookupInput: RuntimeLookupInput;
  store: RuntimeLookupStore;
}): Promise<RuntimeLookupResult> {
  if (input.runtimeLookupInput.owner.kind !== "owner_account") {
    return {
      reason: "owner_kind_unsupported",
      status: "invalid_identity",
    };
  }

  const result = await input.store.readRuntimeRecord({
    runtimeLookupInput: input.runtimeLookupInput,
  });
  return result;
}
