import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  confirmMacUpdateInstallReceipt,
  parseMacUpdateInstallReceipt,
  readMacUpdateInstallReceipt,
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
  it("parses only the bounded install lifecycle fields", () => {
    expect(
      parseMacUpdateInstallReceipt(
        [
          "state=launch_attempted",
          "sourceVersion=0.1.3",
          "targetVersion=0.1.4",
          "sourceBundle=OpenMeld Desktop.app",
          "targetBundle=OpenMeld.app",
          "",
        ].join("\n")
      )
    ).toEqual({
      state: "launch_attempted",
      sourceVersion: "0.1.3",
      targetVersion: "0.1.4",
      sourceBundle: "OpenMeld Desktop.app",
      targetBundle: "OpenMeld.app",
    });
    expect(() =>
      parseMacUpdateInstallReceipt(
        [
          "state=launch_attempted",
          "sourceVersion=0.1.3",
          "targetVersion=0.1.4",
          "sourceBundle=OpenMeld Desktop.app",
          "targetBundle=OpenMeld.app",
          "unexpected=user-content",
        ].join("\n")
      )
    ).toThrow("malformed");
  });

  it("returns null when no previous rename install exists", () => {
    expect(
      readMacUpdateInstallReceipt(join(createRoot(), "missing.txt"))
    ).toBeNull();
  });

  it("records application_started only from the expected relaunched bundle and version", () => {
    const receiptPath = join(createRoot(), "receipt.txt");
    writeFileSync(
      receiptPath,
      [
        "state=launch_attempted",
        "sourceVersion=0.1.3",
        "targetVersion=0.1.4",
        "sourceBundle=OpenMeld Desktop.app",
        "targetBundle=OpenMeld.app",
        "",
      ].join("\n")
    );
    expect(
      confirmMacUpdateInstallReceipt({
        receiptPath,
        currentVersion: "0.1.4",
        currentBundle: "/Applications/OpenMeld.app",
      })
    ).toMatchObject({ state: "application_started" });
    expect(readFileSync(receiptPath, "utf8")).toContain(
      "state=application_started"
    );
  });

  it("does not manufacture success for the wrong version or folder", () => {
    const receiptPath = join(createRoot(), "receipt.txt");
    writeFileSync(
      receiptPath,
      [
        "state=launch_attempted",
        "sourceVersion=0.1.3",
        "targetVersion=0.1.4",
        "sourceBundle=OpenMeld Desktop.app",
        "targetBundle=OpenMeld.app",
        "",
      ].join("\n")
    );
    expect(
      confirmMacUpdateInstallReceipt({
        receiptPath,
        currentVersion: "0.1.3",
        currentBundle: "/Applications/OpenMeld Desktop.app",
      })
    ).toMatchObject({ state: "launch_attempted" });
    expect(readFileSync(receiptPath, "utf8")).toContain(
      "state=launch_attempted"
    );
  });
});
