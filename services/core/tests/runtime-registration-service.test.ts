import {
  type AuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
  type RuntimeLookupInput,
} from "@openmeld/agent-runtime";
import { describe, expect, it } from "vitest";
import {
  type RuntimeRegistrationStore,
  registerRuntime,
} from "../src/runtime-registry/application/runtime-registration-service";

describe("runtime registration service", () => {
  it("creates one opaque Runtime Registry openMeldServiceRuntimeId on first registration", async () => {
    const store = createInMemoryRuntimeRegistrationStore();
    const runtimeLookupInput = createOwnerAccountLookupInput({
      ownerId: "owner-1",
      deviceId: "device-1",
      lane: "openmeld-dev",
    });

    await expect(
      registerRuntime({
        createRuntimeId: () => "runtime_test_1",
        forgottenDeviceStore: createInMemoryForgottenDeviceStore(),
        nowMs: Date.parse("2026-05-02T00:00:00.000Z"),
        ownerAuthorization: { status: "allowed" },
        runtimeLookupInput,
        store,
      })
    ).resolves.toEqual({
      status: "created",
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime_test_1",
      },
    });

    expect(store.records).toEqual([
      {
        createdAtMs: Date.parse("2026-05-02T00:00:00.000Z"),
        lastRegisteredAtMs: Date.parse("2026-05-02T00:00:00.000Z"),
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime_test_1",
        },
        runtimeLookupInput,
        updatedAtMs: Date.parse("2026-05-02T00:00:00.000Z"),
      },
    ]);
  });

  it.each([
    "denied",
    "unknown",
    "unavailable",
  ] as const)("fails closed without writing when owner authorization is %s", async (authorizationStatus) => {
    const store = createInMemoryRuntimeRegistrationStore();

    await expect(
      registerRuntime({
        createRuntimeId: () => "runtime_test_1",
        forgottenDeviceStore: createInMemoryForgottenDeviceStore(),
        nowMs: Date.parse("2026-05-02T00:00:00.000Z"),
        ownerAuthorization: { status: authorizationStatus },
        runtimeLookupInput: createOwnerAccountLookupInput({
          ownerId: "owner-1",
          deviceId: "device-1",
          lane: "openmeld-dev",
        }),
        store,
      })
    ).resolves.toEqual({
      reason: `owner_authorization_${authorizationStatus}`,
      status: "conflict",
    });

    expect(store.records).toEqual([]);
  });

  it("blocks forgotten owner-account devices without writing registration truth", async () => {
    const store = createInMemoryRuntimeRegistrationStore();

    await expect(
      registerRuntime({
        createRuntimeId: () => "runtime_test_1",
        forgottenDeviceStore: createInMemoryForgottenDeviceStore({
          forgottenAtMs: Date.parse("2026-05-01T00:00:00.000Z"),
        }),
        nowMs: Date.parse("2026-05-02T00:00:00.000Z"),
        ownerAuthorization: { status: "allowed" },
        runtimeLookupInput: createOwnerAccountLookupInput({
          ownerId: "owner-1",
          deviceId: "device-1",
          lane: "openmeld-dev",
        }),
        store,
      })
    ).resolves.toEqual({
      reason: "device_forgotten",
      status: "conflict",
    });

    expect(store.records).toEqual([]);
  });

  it("rejects owner-principal registration until owner-principal storage semantics exist", async () => {
    const store = createInMemoryRuntimeRegistrationStore();

    await expect(
      registerRuntime({
        createRuntimeId: () => "runtime_test_1",
        forgottenDeviceStore: createInMemoryForgottenDeviceStore(),
        nowMs: Date.parse("2026-05-02T00:00:00.000Z"),
        ownerAuthorization: { status: "allowed" },
        runtimeLookupInput: createRuntimeLookupInput({
          deviceId: "device-1",
          lane: "openmeld-dev",
          owner: {
            id: "principal-1",
            kind: "owner_principal",
          },
        }),
        store,
      })
    ).resolves.toEqual({
      reason: "owner_kind_unsupported",
      status: "invalid_identity",
    });

    expect(store.records).toEqual([]);
  });

  it("rejects lookup-derived openMeldServiceRuntimeId values before writing", async () => {
    const store = createInMemoryRuntimeRegistrationStore();
    const runtimeLookupInput = createOwnerAccountLookupInput({
      ownerId: "owner-1",
      deviceId: "device-1",
      lane: "openmeld-dev",
    });

    await expect(
      registerRuntime({
        createRuntimeId: () => "owner_account:owner-1:device-1:openmeld-dev",
        forgottenDeviceStore: createInMemoryForgottenDeviceStore(),
        nowMs: Date.parse("2026-05-02T00:00:00.000Z"),
        ownerAuthorization: { status: "allowed" },
        runtimeLookupInput,
        store,
      })
    ).resolves.toEqual({
      reason: "openmeld_service_runtime_id_not_opaque",
      status: "invalid_identity",
    });

    expect(store.records).toEqual([]);
  });
});

function createOwnerAccountLookupInput(input: {
  deviceId: string;
  lane: string;
  ownerId: string;
}): RuntimeLookupInput {
  return createRuntimeLookupInput({
    deviceId: input.deviceId,
    lane: input.lane,
    owner: {
      id: input.ownerId,
      kind: "owner_account",
    },
  });
}

function createInMemoryForgottenDeviceStore(input?: { forgottenAtMs: number }) {
  return {
    readForgottenDevice: async () =>
      input ? { forgottenAtMs: input.forgottenAtMs } : null,
  };
}

function createInMemoryRuntimeRegistrationStore(): RuntimeRegistrationStore & {
  records: Array<{
    createdAtMs: number;
    lastRegisteredAtMs: number;
    openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
    runtimeLookupInput: RuntimeLookupInput;
    updatedAtMs: number;
  }>;
} {
  const records: Array<{
    createdAtMs: number;
    lastRegisteredAtMs: number;
    openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
    runtimeLookupInput: RuntimeLookupInput;
    updatedAtMs: number;
  }> = [];

  return {
    records,
    registerRuntimeRecord: (input) => {
      records.push({
        createdAtMs: input.nowMs,
        lastRegisteredAtMs: input.nowMs,
        openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
        runtimeLookupInput: input.runtimeLookupInput,
        updatedAtMs: input.nowMs,
      });
      return Promise.resolve({
        status: "created",
        openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
      });
    },
  };
}
