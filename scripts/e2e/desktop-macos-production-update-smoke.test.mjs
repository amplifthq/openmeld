import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProductionSignatureDetails,
  assertReceiptMatchesTarget,
  compareStableVersions,
  assertProcessRestarted,
  parseInstallReceipt,
  parseSmokeArgs,
  processListHasProductionApp,
  productionProcessPids,
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
  const output = [
    "101 /bin/zsh",
    `202 ${PRODUCTION_EXECUTABLE}`,
    "303 /usr/bin/open /tmp/Other.app",
  ].join("\n");
  assert.deepEqual(productionProcessPids(output), [202]);
  assert.equal(processListHasProductionApp(output), true);
  assert.equal(
    processListHasProductionApp(
      "404 /Applications/OpenMeld Desktop.app/Contents/MacOS/OpenMeld\n"
    ),
    false
  );
});

test("requires the updater to replace the pre-update process", () => {
  assert.doesNotThrow(() => assertProcessRestarted([101], [202]));
  assert.throws(() => assertProcessRestarted([101], [101]), /still running/u);
  assert.throws(() => assertProcessRestarted([101], []), /not running/u);
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
