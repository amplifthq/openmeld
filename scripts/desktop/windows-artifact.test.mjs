import assert from "node:assert/strict";
import test from "node:test";
import { readInstalledDesktopTarget } from "./installed-target.ts";
import {
  assertWindowsCandidateContents,
  assertWindowsPeArchitecture,
} from "./windows-artifact.mjs";

const target = readInstalledDesktopTarget({
  OPENMELD_DESKTOP_TARGET: "production",
});
const windows = { platform: "windows-x64", publisherName: "Fixture Publisher" };
const base = {
  windows,
  approvedSha: "a".repeat(40),
  version: "0.1.4",
  source: {
    releaseSha: "a".repeat(40),
    webBuild: "b".repeat(64),
    target,
    windows,
  },
  marker: { webBuild: "b".repeat(64), installedTarget: target },
  packageName: "@openmeld/desktop",
  packageVersion: "0.1.4",
  updateConfig: {
    provider: "generic",
    url: "https://openmeld.ai/desktop/updates/windows-x64",
    publisherName: [windows.publisherName],
  },
};
function pe(machine) {
  const bytes = Buffer.alloc(256);
  bytes.writeUInt16LE(0x5a_4d, 0);
  bytes.writeUInt32LE(128, 0x3c);
  bytes.writeUInt32LE(0x45_50, 128);
  bytes.writeUInt16LE(machine, 132);
  return bytes;
}
test("verifies exact PE machine rather than a filename or host architecture guess", () => {
  assertWindowsPeArchitecture(pe(0x86_64), "windows-x64");
  assertWindowsPeArchitecture(pe(0xaa_64), "windows-arm64");
  assert.throws(() =>
    assertWindowsPeArchitecture(pe(0x86_64), "windows-arm64")
  );
  assert.throws(() => assertWindowsPeArchitecture(pe(0xaa_64), "windows-x64"));
  assert.throws(() => assertWindowsPeArchitecture(pe(0x1_4c), "windows-x64"));
  assert.throws(() => assertWindowsPeArchitecture(pe(0x86_64), "macos-arm64"));
});
test("rejects truncated, malformed and out-of-range PE headers without unchecked reads", () => {
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.alloc(64),
    pe(0x86_64).subarray(0, 132),
  ]) {
    assert.throws(() => assertWindowsPeArchitecture(bytes, "windows-x64"));
  }
  const overflow = pe(0x86_64);
  overflow.writeUInt32LE(0xff_ff_ff_ff, 0x3c);
  assert.throws(() => assertWindowsPeArchitecture(overflow, "windows-x64"));
});
test("binds the signed payload's receipt, renderer, version, target and publisher", () => {
  assert.equal(assertWindowsCandidateContents(base), base.approvedSha);
});
for (const override of [
  { approvedSha: "c".repeat(40) },
  { version: "0.1.5" },
  { packageName: "unrelated-app" },
  { source: { ...base.source, windows: undefined } },
  { marker: { ...base.marker, webBuild: "d".repeat(64) } },
  {
    marker: {
      ...base.marker,
      installedTarget: { ...target, webOrigin: "https://other.invalid" },
    },
  },
  { windows: { ...windows, publisherName: "Other Publisher" } },
  { windows: { ...windows, platform: "windows-arm64" } },
  { updateConfig: { ...base.updateConfig, publisherName: undefined } },
  {
    updateConfig: {
      ...base.updateConfig,
      url: "https://openmeld.ai/desktop/updates",
    },
  },
]) {
  test(`rejects unbound Windows candidate content: ${JSON.stringify(override)}`, () => {
    assert.throws(() =>
      assertWindowsCandidateContents({ ...base, ...override })
    );
  });
}
