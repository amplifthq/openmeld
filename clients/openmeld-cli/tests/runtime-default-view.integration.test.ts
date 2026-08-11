import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveOpenMeldAccountContext } from "../src/config/account-context";
import { accountProfileViewPath } from "../src/config/paths";
import {
  getProfileDefaultView,
  setProfileDefaultView,
} from "../src/config/profile-view";
import { withTempHome } from "./helpers/fs";

describe("runtime default view", () => {
  it("persists default view per profile", async () => {
    await withTempHome(async () => {
      expect(await getProfileDefaultView("human-profile")).toBe("auto");
      expect(await getProfileDefaultView("agent-profile")).toBe("auto");

      await setProfileDefaultView({
        openMeldProfileId: "human-profile",
        view: "agent",
      });
      expect(await getProfileDefaultView("human-profile")).toBe("agent");
      expect(await getProfileDefaultView("agent-profile")).toBe("auto");

      await setProfileDefaultView({
        openMeldProfileId: "human-profile",
        view: "human",
      });
      expect(await getProfileDefaultView("human-profile")).toBe("human");
      expect(await getProfileDefaultView("agent-profile")).toBe("auto");
    });
  });

  it("clears profile view override when set to auto", async () => {
    await withTempHome(async () => {
      await setProfileDefaultView({
        openMeldProfileId: "demo",
        view: "agent",
      });
      expect(await getProfileDefaultView("demo")).toBe("agent");

      await setProfileDefaultView({
        openMeldProfileId: "demo",
        view: "auto",
      });
      expect(await getProfileDefaultView("demo")).toBe("auto");
      await expect(readStoredProfileView(pathForProfile("demo"))).resolves.toBe(
        null
      );
    });
  });

  it("rewrites a legacy-only file to the canonical shape", async () => {
    await withTempHome(async () => {
      const path = pathForProfile("human-profile");
      await writeStoredProfileView(path, {
        v: 1,
        profile: "human-profile",
        defaultView: "agent",
        updatedAt: "2026-03-31T00:00:00.000Z",
      });

      await expect(getProfileDefaultView("human-profile")).resolves.toBe(
        "agent"
      );
      await expect(readStoredProfileView(path)).resolves.toEqual({
        v: 1,
        openMeldProfileId: "human-profile",
        defaultView: "agent",
        updatedAt: "2026-03-31T00:00:00.000Z",
      });
    });
  });

  it("keeps openMeldProfileId as the winner and removes the legacy field", async () => {
    await withTempHome(async () => {
      const path = pathForProfile("human-profile");
      await writeStoredProfileView(path, {
        v: 1,
        openMeldProfileId: "human-profile",
        profile: "agent-profile",
        defaultView: "human",
        updatedAt: "2026-03-31T00:00:00.000Z",
      });

      await expect(getProfileDefaultView("human-profile")).resolves.toBe(
        "human"
      );
      await expect(readStoredProfileView(path)).resolves.toEqual({
        v: 1,
        openMeldProfileId: "human-profile",
        defaultView: "human",
        updatedAt: "2026-03-31T00:00:00.000Z",
      });
    });
  });

  it("deletes a mismatched file instead of silently moving it", async () => {
    await withTempHome(async () => {
      const path = pathForProfile("human-profile");
      const unexpectedTargetPath = pathForProfile("agent-profile");
      await writeStoredProfileView(path, {
        v: 1,
        openMeldProfileId: "agent-profile",
        defaultView: "agent",
        updatedAt: "2026-03-31T00:00:00.000Z",
      });

      await expect(getProfileDefaultView("human-profile")).resolves.toBe(
        "auto"
      );
      await expect(readStoredProfileView(path)).resolves.toBe(null);
      await expect(readStoredProfileView(unexpectedTargetPath)).resolves.toBe(
        null
      );
    });
  });
});

function pathForProfile(openMeldProfileId: string): string {
  const account = resolveOpenMeldAccountContext();
  return accountProfileViewPath(account.key, openMeldProfileId);
}

async function writeStoredProfileView(
  path: string,
  payload: Record<string, unknown>
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function readStoredProfileView(
  path: string
): Promise<Record<string, unknown> | null> {
  const raw = await readFile(path, "utf8").catch(() => null);
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as Record<string, unknown>;
}
