import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  confirmMacUpdateInstallReceipt,
  parseMacUpdateInstallReceipt,
  readMacUpdateInstallReceipt,
  recordMacUpdateInstallRequested,
} from "../src/main/update/mac-update-receipt";

const roots: string[] = [];

function createRoot() {
  const root = mkdtempSync(join(tmpdir(), "openmeld-update-receipt-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("macOS Desktop update install receipt", () => {
  it("records only bounded same-name install facts before native installation", () => {
    const receiptPath = join(createRoot(), "receipt.txt");
    expect(
      recordMacUpdateInstallRequested({
        receiptPath,
        currentVersion: "0.1.4",
        targetVersion: "0.1.5",
        currentBundle: "/Applications/OpenMeld.app",
      })
    ).toEqual({
      state: "install_requested",
      sourceVersion: "0.1.4",
      targetVersion: "0.1.5",
      sourceBundle: "OpenMeld.app",
      targetBundle: "OpenMeld.app",
    });
    expect(readFileSync(receiptPath, "utf8")).not.toContain("/Applications/");
  });

  it("returns null when no previous install request exists", () => {
    expect(
      readMacUpdateInstallReceipt(join(createRoot(), "missing.txt"))
    ).toBeNull();
  });

  it("marks the install complete only when the expected new Main actually starts", () => {
    const receiptPath = join(createRoot(), "receipt.txt");
    recordMacUpdateInstallRequested({
      receiptPath,
      currentVersion: "0.1.4",
      targetVersion: "0.1.5",
      currentBundle: "/Applications/OpenMeld.app",
    });
    expect(
      confirmMacUpdateInstallReceipt({
        receiptPath,
        currentVersion: "0.1.4",
        currentBundle: "/Applications/OpenMeld.app",
      })
    ).toMatchObject({ state: "install_requested" });
    expect(
      confirmMacUpdateInstallReceipt({
        receiptPath,
        currentVersion: "0.1.5",
        currentBundle: "/Applications/OpenMeld.app",
      })
    ).toMatchObject({ state: "application_started" });
  });

  it("rejects receipt fields outside the bounded local contract", () => {
    expect(() =>
      parseMacUpdateInstallReceipt(
        [
          "state=install_requested",
          "sourceVersion=0.1.4",
          "targetVersion=0.1.5",
          "sourceBundle=OpenMeld.app",
          "targetBundle=OpenMeld.app",
          "unexpected=user-content",
        ].join("\n")
      )
    ).toThrow("malformed");
  });

  it("refuses to create install evidence from a legacy folder", () => {
    expect(() =>
      recordMacUpdateInstallRequested({
        receiptPath: join(createRoot(), "receipt.txt"),
        currentVersion: "0.1.3",
        targetVersion: "0.1.5",
        currentBundle: "/Applications/OpenMeld Desktop.app",
      })
    ).toThrow("unexpected app folder");
  });
});
