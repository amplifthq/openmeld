import {
  type AuthorityOpenMeldServiceRuntimeId,
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
  type RuntimeLookupInput,
} from "@openmeld/agent-runtime";
import { describe, expect, it } from "vitest";
import {
  lookupRuntime,
  type RuntimeLookupStore,
} from "../src/runtime-registry/application/runtime-lookup-service";

describe("runtime lookup service", () => {
  it("returns the stored opaque openMeldServiceRuntimeId for an owner-account lookup", async () => {
    const runtimeLookupInput = createOwnerAccountLookupInput({
      ownerId: "owner-1",
      deviceId: "device-1",
      lane: "openmeld-dev",
    });
    const openMeldServiceRuntimeId = createAuthorityOpenMeldServiceRuntimeId({
      lookupInput: runtimeLookupInput,
      openMeldServiceRuntimeId: "runtime_test_1",
      source: "runtime_registry_authority",
    });

    await expect(
      lookupRuntime({
        runtimeLookupInput,
        store: createInMemoryRuntimeLookupStore({
          openMeldServiceRuntimeId,
          runtimeLookupInput,
        }),
      })
    ).resolves.toEqual({
      openMeldServiceRuntimeId,
      status: "found",
    });
  });

  it("returns missing without allocating a fallback openMeldServiceRuntimeId", async () => {
    await expect(
      lookupRuntime({
        runtimeLookupInput: createOwnerAccountLookupInput({
          ownerId: "owner-1",
          deviceId: "device-1",
          lane: "openmeld-dev",
        }),
        store: createInMemoryRuntimeLookupStore(),
      })
    ).resolves.toEqual({
      status: "missing",
    });
  });

  it("rejects owner-principal lookup until owner-principal storage semantics exist", async () => {
    await expect(
      lookupRuntime({
        runtimeLookupInput: createRuntimeLookupInput({
          deviceId: "device-1",
          lane: "openmeld-dev",
          owner: {
            id: "principal-1",
            kind: "owner_principal",
          },
        }),
        store: createInMemoryRuntimeLookupStore(),
      })
    ).resolves.toEqual({
      reason: "owner_kind_unsupported",
      status: "invalid_identity",
    });
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

function createInMemoryRuntimeLookupStore(record?: {
  openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
  runtimeLookupInput: RuntimeLookupInput;
}): RuntimeLookupStore {
  return {
    readRuntimeRecord: async () =>
      record
        ? {
            openMeldServiceRuntimeId: record.openMeldServiceRuntimeId,
            status: "found",
          }
        : {
            status: "missing",
          },
  };
}
