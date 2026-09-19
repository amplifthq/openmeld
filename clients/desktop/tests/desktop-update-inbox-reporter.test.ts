import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DesktopUpdaterState } from "@openmeld/schemas";
import type { DesktopUpdateObservation } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopUpdateInboxReporter } from "../src/main/update/desktop-update-inbox-reporter";

const paths: string[] = [];
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) {
    dispose();
  }
  for (const path of paths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});
const state: DesktopUpdaterState = {
  status: "idle",
  currentVersion: "0.1.3",
  version: null,
  percent: null,
  errorStage: null,
};

describe("native update observation reporter", () => {
  it("keeps a durable installation identity, suppresses progress/check noise and only reports installation from app version", async () => {
    const f = fixture();
    await f.reporter.observe(state);
    const available = {
      ...state,
      status: "available" as const,
      version: "0.1.4",
    };
    await f.reporter.observe(available);
    await f.reporter.observe({ ...available, status: "checking" });
    await f.reporter.observe({
      ...available,
      status: "downloading",
      percent: 45,
    });
    await f.reporter.observe({
      ...available,
      status: "downloaded",
      percent: 100,
    });
    await f.reporter.observe({ ...available, status: "installing" });
    expect(f.sent).toHaveLength(2);
    expect(f.sent[1]).toMatchObject({
      installedVersion: "0.1.3",
      availableVersion: "0.1.4",
    });
    const id = f.reporter.identity.installationId;
    f.reporter.dispose();
    const second = f.restart();
    await second.observe({ ...state, currentVersion: "0.1.4" });
    expect(second.identity.installationId).toBe(id);
    expect(f.sent[2]).toMatchObject({
      installationId: id,
      installedVersion: "0.1.4",
    });
    expect(f.sent[2]).not.toHaveProperty("availableVersion");
    expect(f.sent[2]?.sequence).toBeGreaterThan(f.sent[1]?.sequence ?? 0);
  });

  it("never retargets an in-flight old-account fact and reports current source facts separately after account invalidation", async () => {
    const f = fixture();
    let finish: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      finish = resolve;
    });
    f.send.mockImplementationOnce(async (observation) => {
      f.sent.push(observation);
      await blocked;
      return { accepted: true, sequence: observation.sequence };
    });
    const work = f.reporter.observe({
      ...state,
      status: "available",
      version: "0.1.4",
    });
    await vi.waitFor(() => expect(f.sent).toHaveLength(1));
    f.user.id = "other-account";
    f.reporter.accountChanged();
    finish?.();
    await work;
    expect(f.sent.map((item) => item.expectedUserId)).toEqual([
      "owner",
      "other-account",
    ]);
    expect(f.sent[0]?.installationId).toBe(f.sent[1]?.installationId);
  });

  it("contains reporting failure and never reuses its persisted sequence on retry", async () => {
    const f = fixture();
    f.send.mockRejectedValueOnce(new Error("Inbox offline"));
    await expect(
      f.reporter.observe({ ...state, status: "available", version: "0.1.4" })
    ).resolves.toBeUndefined();
    const sequence = JSON.parse(
      readFileSync(join(f.path, "desktop-inbox-installation.json"), "utf8")
    ).sequence;
    await f.reporter.observe({
      ...state,
      status: "available",
      version: "0.1.4",
    });
    expect(f.sent[0]?.sequence).toBeGreaterThan(sequence);
  });

  it("fails closed on corrupt installation identity instead of fabricating a new device", () => {
    const f = fixture();
    f.reporter.dispose();
    writeFileSync(join(f.path, "desktop-inbox-installation.json"), "not-json");
    expect(() => f.restart()).toThrow();
  });
});

function fixture() {
  const path = mkdtempSync(join(tmpdir(), "openmeld-inbox-updater-"));
  paths.push(path);
  const sent: DesktopUpdateObservation[] = [];
  const user = { id: "owner" };
  const send = vi.fn((observation: DesktopUpdateObservation) => {
    sent.push(observation);
    return Promise.resolve({ accepted: true, sequence: observation.sequence });
  });
  const restart = () => {
    const reporter = createDesktopUpdateInboxReporter({
      userData: path,
      lane: "dev-local",
      platform: "darwin",
      deviceName: "Test Mac",
      currentUserId: () => Promise.resolve(user.id),
      send,
    });
    cleanup.push(reporter.dispose);
    return reporter;
  };
  return { path, sent, user, send, restart, reporter: restart() };
}
