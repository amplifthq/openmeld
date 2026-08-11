import { describe, expect, it } from "vitest";
import {
  assertAuthoritativeReadyOpenMeldServiceRuntimeId,
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
} from "../src";

describe("agent-runtime runtime id contract", () => {
  it("keeps owner, device, and lane as lookup input instead of openMeldServiceRuntimeId", () => {
    const lookupInput = createRuntimeLookupInput({
      owner: {
        kind: "owner_account",
        id: "account-1",
      },
      deviceId: "device-1",
      lane: "openmeld-dev",
    });

    expect(lookupInput).toEqual({
      owner: {
        kind: "owner_account",
        id: "account-1",
      },
      deviceId: "device-1",
      lane: "openmeld-dev",
    });

    expect(() =>
      createAuthorityOpenMeldServiceRuntimeId({
        lookupInput,
        openMeldServiceRuntimeId:
          "owner_account:account-1:device-1:openmeld-dev",
        source: "runtime_registry_authority",
      })
    ).toThrow("runtime.id_not_opaque");
  });

  it("requires openMeldServiceRuntimeId to come from Runtime Registry authority evidence", () => {
    const lookupInput = createRuntimeLookupInput({
      owner: {
        kind: "owner_account",
        id: "account-1",
      },
      deviceId: "device-1",
      lane: "openmeld-dev",
    });

    const testOnlyAuthority = {
      lookupRuntimeId: () =>
        createAuthorityOpenMeldServiceRuntimeId({
          lookupInput,
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
          source: "runtime_registry_authority",
        }),
    };

    expect(testOnlyAuthority.lookupRuntimeId()).toEqual({
      value: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
      source: "runtime_registry_authority",
    });

    expect(() =>
      createAuthorityOpenMeldServiceRuntimeId({
        lookupInput,
        openMeldServiceRuntimeId: "rt_client_computed",
        source: "client_computed",
      })
    ).toThrow("runtime.id_source_invalid");
  });

  it("keeps authoritative ready openMeldServiceRuntimeId enforcement isolated from display readiness", () => {
    expect(() => assertAuthoritativeReadyOpenMeldServiceRuntimeId({})).toThrow(
      "runtime.id_missing"
    );

    expect(() =>
      assertAuthoritativeReadyOpenMeldServiceRuntimeId({
        openMeldServiceRuntimeId: createAuthorityOpenMeldServiceRuntimeId({
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
          source: "runtime_registry_authority",
        }),
      })
    ).not.toThrow();
  });
});
