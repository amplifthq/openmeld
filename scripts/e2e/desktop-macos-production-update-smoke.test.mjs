import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProductionSignatureDetails,
  assertReceiptMatchesTarget,
  compareStableVersions,
  parseInstallReceipt,
  parseSmokeArgs,
  processListHasProductionApp,
  PRODUCTION_EXECUTABLE,
} from "./desktop-macos-production-update-smoke.mjs";

test("parses the thin release smoke phases", () => {
  assert.deepEqual(parseSmokeArgs(["before", "0.1.4", "0.1.5"]), {
    phase: "before",
    currentVersion: "0.1.4",
    targetVersion: "0.1.5",
  });
  assert.deepEqual(parseSmokeArgs(["after", "0.1.5"]), {
    phase: "after",
    targetVersion: "0.1.5",
  });
  assert.throws(
    () => parseSmokeArgs(["before", "0.1.5", "0.1.5"]),
    /must be newer/u
  );
  assert.throws(() => parseSmokeArgs(["before", "0.1", "0.1.5"]), /stable/u);
});

test("compares stable Desktop versions numerically", () => {
  assert.equal(compareStableVersions("0.1.9", "0.1.10"), -1);
  assert.equal(compareStableVersions("0.2.0", "0.1.99"), 1);
  assert.equal(compareStableVersions("1.0.0", "1.0.0"), 0);
});

test("requires the production Apple signing identity", () => {
  const valid = [
    "Identifier=sh.openmeld.desktop",
    "Authority=Developer ID Application: SOPHIAPRO PTE. LTD. (38FFHDPA3B)",
    "TeamIdentifier=38FFHDPA3B",
  ].join("\n");
  assert.doesNotThrow(() => assertProductionSignatureDetails(valid));
  assert.throws(
    () =>
      assertProductionSignatureDetails(
        valid.replace("TeamIdentifier=38FFHDPA3B", "TeamIdentifier=OTHER")
      ),
    /Team ID/u
  );
});

test("matches only a process running from the production app executable", () => {
  assert.equal(
    processListHasProductionApp(
      `/bin/zsh\n${PRODUCTION_EXECUTABLE}\n/usr/bin/open /tmp/Other.app\n`
    ),
    true
  );
  assert.equal(
    processListHasProductionApp(
      "/Applications/OpenMeld Desktop.app/Contents/MacOS/OpenMeld\n"
    ),
    false
  );
});

test("validates bounded updater receipt evidence when it exists", () => {
  const receipt = parseInstallReceipt(
    [
      "state=application_started",
      "sourceVersion=0.1.4",
      "targetVersion=0.1.5",
      "sourceBundle=OpenMeld.app",
      "targetBundle=OpenMeld.app",
      "",
    ].join("\n")
  );
  assert.doesNotThrow(() => assertReceiptMatchesTarget(receipt, "0.1.5"));
  assert.throws(
    () =>
      assertReceiptMatchesTarget(
        { ...receipt, state: "install_requested" },
        "0.1.5"
      ),
    /application_started/u
  );
  assert.throws(
    () => assertReceiptMatchesTarget(receipt, "0.1.6"),
    /not 0.1.6/u
  );
});
