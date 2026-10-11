import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenMeldAccountContext } from "../src/config/account-context";
import { accountProfileLocalMetaPath } from "../src/config/paths";
import { readLocalAgentProfileWorkspace } from "../src/local-service/carrier/read-profile-workspace";
import { withTempHome } from "./helpers/fs";

const accountMock = vi.hoisted(() => vi.fn());
vi.mock("../src/config/account-context", async () => ({
  ...(await vi.importActual<typeof import("../src/config/account-context")>(
    "../src/config/account-context"
  )),
  resolveCurrentOpenMeldAccountContext: accountMock,
}));
const account: OpenMeldAccountContext = {
  source: "session",
  key: { hostKey: "test.invalid", userKey: "owner-a" },
  user: { id: "owner-a" },
};

describe("owner-local saved workspace reads", () => {
  beforeEach(() => accountMock.mockReset());
  it.each([
    "same_account",
    "signed_out",
    "foreign_owner",
    "account_changed_during_read",
  ] as const)("preserves private configuration admission (%s)", async (state) => {
    await withTempHome(async () => {
      const targetProfileId = "agt-local-read";
      const path = accountProfileLocalMetaPath(account.key, targetProfileId);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(
        path,
        JSON.stringify({
          v: 2,
          openMeldProfileId: targetProfileId,
          updatedAt: "2026-10-09T00:00:00Z",
          workspace: {
            mode: "custom",
            customWorkspacePath: "/private/owner-a/Project 中文 ",
          },
        })
      );
      if (state === "signed_out") {
        accountMock.mockResolvedValue({ source: "fallback", key: account.key });
      } else if (state === "foreign_owner") {
        accountMock.mockResolvedValue({ ...account, user: { id: "owner-b" } });
      } else if (state === "account_changed_during_read") {
        accountMock.mockResolvedValueOnce(account).mockResolvedValue({
          ...account,
          key: { ...account.key, hostKey: "other.invalid" },
        });
      } else {
        accountMock.mockResolvedValue(account);
      }
      const result = await readLocalAgentProfileWorkspace({
        ownerUserId: "owner-a",
        targetProfileId,
      });
      if (state === "same_account") {
        expect(result).toMatchObject({
          accepted: true,
          status: "read",
          workspace: {
            status: "configured",
            workspaceMode: "custom",
            workspacePath: "/private/owner-a/Project 中文 ",
          },
        });
      } else {
        expect(result).toMatchObject({
          accepted: false,
          status: "rejected",
          reasonCode: "local_agent_control.account_mismatch",
        });
        expect(JSON.stringify(result)).not.toContain("/private/");
        expect(result).not.toHaveProperty("workspace");
      }
    });
  });
});
