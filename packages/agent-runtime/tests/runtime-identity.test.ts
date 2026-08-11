import { describe, expect, it } from "vitest";
import {
  createRuntimeIdentityKey,
  openMeldServiceRuntimeIdentityKeysEqual,
} from "../src";

describe("agent-runtime runtime identity key", () => {
  it("normalizes owner, device, and lane into the runtime identity model", () => {
    expect(
      createRuntimeIdentityKey({
        owner: {
          kind: "owner_account",
          id: " account-1 ",
        },
        deviceId: " device-1 ",
        lane: " openmeld-dev ",
      })
    ).toEqual({
      owner: {
        kind: "owner_account",
        id: "account-1",
      },
      deviceId: "device-1",
      lane: "openmeld-dev",
    });
  });

  it("supports owner principal while keeping the owner relation explicit", () => {
    expect(
      createRuntimeIdentityKey({
        owner: {
          kind: "owner_principal",
          id: " user-1 ",
        },
        deviceId: "device-1",
        lane: "openmeld",
      })
    ).toEqual({
      owner: {
        kind: "owner_principal",
        id: "user-1",
      },
      deviceId: "device-1",
      lane: "openmeld",
    });
  });

  it("rejects product, auth, session, and transport scopes as identity roots", () => {
    for (const forbiddenScope of [
      "agentProfileId",
      "humanProfileId",
      "spaceId",
      "startSessionId",
      "webSocketId",
      "pid",
      "callerPrincipalId",
    ]) {
      expect(() =>
        createRuntimeIdentityKey({
          owner: {
            kind: "owner_account",
            id: "account-1",
          },
          deviceId: "device-1",
          lane: "openmeld-dev",
          [forbiddenScope]: `${forbiddenScope}-value`,
        })
      ).toThrow(
        `runtime.identity_forbidden_scope: ${forbiddenScope} is not part of Runtime identity`
      );
    }
  });

  it("keeps lanes isolated for the same owner and device", () => {
    const dev = createRuntimeIdentityKey({
      owner: {
        kind: "owner_account",
        id: "account-1",
      },
      deviceId: "device-1",
      lane: "openmeld-dev",
    });
    const canary = createRuntimeIdentityKey({
      owner: {
        kind: "owner_account",
        id: "account-1",
      },
      deviceId: "device-1",
      lane: "openmeld-canary",
    });

    expect(openMeldServiceRuntimeIdentityKeysEqual(dev, canary)).toBe(false);
    expect(openMeldServiceRuntimeIdentityKeysEqual(dev, { ...dev })).toBe(true);
  });
});
