import {
  type AuthorityOpenMeldServiceRuntimeId,
  createAuthorityOpenMeldServiceRuntimeId,
  type RuntimeLookupInput,
} from "@openmeld/agent-runtime";

export type RuntimeRegistrationOwnerAuthorizationEvidence =
  | {
      status: "allowed";
    }
  | {
      status: "denied" | "unknown" | "unavailable";
      reason?: string;
    };

export type RuntimeRegistrationStoreRecordInput = {
  nowMs: number;
  openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
  runtimeLookupInput: RuntimeLookupInput;
};

export type RuntimeRegistrationStoreResult =
  | {
      status: "created" | "reused";
      openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
    }
  | {
      reason: string;
      status: "conflict";
    };

export type RuntimeRegistrationStore = {
  registerRuntimeRecord: (
    input: RuntimeRegistrationStoreRecordInput
  ) => Promise<RuntimeRegistrationStoreResult>;
};

export type RuntimeRegistrationForgottenDeviceStore = {
  readForgottenDevice: (input: {
    deviceId: string;
    ownerId: string;
  }) => Promise<{ forgottenAtMs: number } | null>;
};

export type RuntimeRegistrationResult =
  | {
      status: "created" | "reused";
      openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
    }
  | {
      reason: string;
      status: "conflict" | "invalid_identity";
    };

export async function registerRuntime(input: {
  createRuntimeId?: () => string;
  forgottenDeviceStore: RuntimeRegistrationForgottenDeviceStore;
  nowMs: number;
  ownerAuthorization: RuntimeRegistrationOwnerAuthorizationEvidence;
  runtimeLookupInput: RuntimeLookupInput;
  store: RuntimeRegistrationStore;
}): Promise<RuntimeRegistrationResult> {
  if (input.ownerAuthorization.status !== "allowed") {
    return {
      reason: `owner_authorization_${input.ownerAuthorization.status}`,
      status: "conflict",
    };
  }

  if (input.runtimeLookupInput.owner.kind !== "owner_account") {
    return {
      reason: "owner_kind_unsupported",
      status: "invalid_identity",
    };
  }

  const forgottenDevice = await input.forgottenDeviceStore.readForgottenDevice({
    deviceId: input.runtimeLookupInput.deviceId,
    ownerId: input.runtimeLookupInput.owner.id,
  });
  if (forgottenDevice) {
    return {
      reason: "device_forgotten",
      status: "conflict",
    };
  }

  const openMeldServiceRuntimeId = createRegistrationRuntimeId({
    createRuntimeId: input.createRuntimeId,
    runtimeLookupInput: input.runtimeLookupInput,
  });
  if (!openMeldServiceRuntimeId.ok) {
    return {
      reason: openMeldServiceRuntimeId.reason,
      status: "invalid_identity",
    };
  }

  return input.store.registerRuntimeRecord({
    nowMs: input.nowMs,
    openMeldServiceRuntimeId: openMeldServiceRuntimeId.value,
    runtimeLookupInput: input.runtimeLookupInput,
  });
}

function createRegistrationRuntimeId(input: {
  createRuntimeId?: () => string;
  runtimeLookupInput: RuntimeLookupInput;
}):
  | {
      ok: true;
      value: AuthorityOpenMeldServiceRuntimeId;
    }
  | {
      ok: false;
      reason: string;
    } {
  try {
    return {
      ok: true,
      value: createAuthorityOpenMeldServiceRuntimeId({
        lookupInput: input.runtimeLookupInput,
        openMeldServiceRuntimeId: (
          input.createRuntimeId ?? createOpaqueRuntimeId
        )(),
        source: "runtime_registry_authority",
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: message.includes("runtime.id_not_opaque")
        ? "openmeld_service_runtime_id_not_opaque"
        : "openmeld_service_runtime_id_invalid",
    };
  }
}

function createOpaqueRuntimeId(): string {
  return `runtime_${crypto.randomUUID().replaceAll("-", "")}`;
}
