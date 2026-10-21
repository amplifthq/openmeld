import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  applyFolderSelectionPolicy,
  resolveFolderSelectionRequesterProfileId,
} from "../src/dispatch/application/accepted-dispatch-snapshot";

// These cases cover the path without request chains; the enforced path is
// covered by the *-request-chain tests.
vi.mock("../src/member-agent/member-agents-feature", () => ({
  isMemberAgentsEnabled: () => false,
  isRequestChainEnforced: () => false,
}));

const FOLDER_ID = "6f1f1d0e-8f8e-4a59-9c39-7d2b8c1e4a11";
const OWNER = "owner-user";

function message(
  contextSelection: OpenMeldDaemonDispatchQueueMessage["contextSelection"],
  requesterProfileId = "owner-human-profile"
): OpenMeldDaemonDispatchQueueMessage {
  // Only the fields the policy reads; the policy never inspects the rest.
  return {
    contextSelection,
    dispatchId: "dispatch-1",
    organizationId: "org-1",
    sourceSignalSnapshot: { profileId: requesterProfileId },
  } as unknown as OpenMeldDaemonDispatchQueueMessage;
}

describe("folder selection policy", () => {
  it("keeps the folder when the one-hop requester is owned by the Binding owner", async () => {
    const readRequesterOwnerUserId = vi.fn(() => Promise.resolve(OWNER));
    const selection = {
      folderId: FOLDER_ID,
      mode: "new" as const,
      workspace: "current" as const,
    };
    await expect(
      applyFolderSelectionPolicy({
        message: message(selection),
        readRequesterOwnerUserId,
        targetOwnerUserId: OWNER,
      })
    ).resolves.toEqual(selection);
    expect(readRequesterOwnerUserId).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        profileId: "owner-human-profile",
      })
    );
  });

  it.each([
    ["another member", () => Promise.resolve<string | null>("colleague-user")],
    ["an unknown requester", () => Promise.resolve<string | null>(null)],
    [
      "unverifiable ownership",
      () => Promise.reject<string | null>(new Error("database unavailable")),
    ],
  ])("strips the folder for %s and keeps the rest of the choice", async (_case, readRequesterOwnerUserId) => {
    await expect(
      applyFolderSelectionPolicy({
        message: message(
          {
            folderId: FOLDER_ID,
            mode: "fork",
            sourceWakeId: "wake-1",
            workspace: "isolated",
          },
          "colleague-human-profile"
        ),
        readRequesterOwnerUserId,
        targetOwnerUserId: OWNER,
      })
    ).resolves.toEqual({
      mode: "fork",
      sourceWakeId: "wake-1",
      workspace: "isolated",
    });
  });

  it("leaves selections without a folder untouched and reads no ownership", async () => {
    const readRequesterOwnerUserId = vi.fn(() => Promise.resolve(null));
    for (const selection of [
      undefined,
      { mode: "auto" as const },
      { mode: "resume" as const, sourceWakeId: "wake-1" },
    ]) {
      await expect(
        applyFolderSelectionPolicy({
          message: message(selection),
          readRequesterOwnerUserId,
          targetOwnerUserId: OWNER,
        })
      ).resolves.toEqual(selection);
    }
    expect(readRequesterOwnerUserId).not.toHaveBeenCalled();
  });

  it("names the one-hop requester as the ownership basis", () => {
    expect(
      resolveFolderSelectionRequesterProfileId(message(undefined, "author"))
    ).toBe("author");
  });
});
