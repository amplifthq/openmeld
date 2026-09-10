import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectPrepareStepDiagnostics } from "../src/commands/prepare-step-diagnostics";
import { daemonLifecycleJournalPath } from "../src/config/daemon-state";
import { runAuditedServiceManagerCarrierMutation } from "../src/local-service/lifecycle/daemon-service-bundle";
import { readDaemonIncidentLogTail } from "../src/local-service/lifecycle/daemon-start-failure-log";
import { collectLocalOperationFailure } from "../src/system/local-operation-diagnostics";
import {
  parseMacOSVersion,
  readMacOSVersion,
} from "../src/system/macos-version";

let root: string;
const PRODUCT_VERSION_PATTERN = /^\d+\.\d+/u;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openmeld-incident-"));
  process.env.OPENMELD_HOME = root;
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const window = {
  startedAt: "2026-09-09T07:30:00.000Z",
  endedAt: "2026-09-09T07:45:00.000Z",
  maxLines: 30,
};

describe("incident log evidence", () => {
  it("excludes stale and undated errors instead of assigning them to the incident", async () => {
    const logPath = join(root, "service.log");
    await writeFile(
      logPath,
      `${[
        "2026-09-06T20:13:54.977Z reporting failed",
        'errorCode: "ETIMEDOUT"',
        "2026-09-09T07:40:14.000Z operation failed ENOENT",
        "2026-09-09T07:40:15.000Z heartbeat connected",
        "2026-09-09T07:46:00.000Z later failure",
      ].join("\n")}\n`
    );
    const result = await readDaemonIncidentLogTail({ ...window, logPath });
    expect(result.lines).toEqual([
      "2026-09-09T07:40:14.000Z operation failed ENOENT",
    ]);
    expect(result.window).toEqual({
      excludedUndatedLines: 1,
      excludedOutsideWindowLines: 2,
      sourceTruncated: false,
    });
  });

  it("reports no recent evidence and distinguishes missing, empty, and unreadable sources", async () => {
    const logPath = join(root, "service.log");
    expect((await readDaemonIncidentLogTail({ ...window, logPath })).note).toBe(
      "file_missing"
    );
    await writeFile(logPath, "");
    expect((await readDaemonIncidentLogTail({ ...window, logPath })).note).toBe(
      "file_empty"
    );
    await writeFile(logPath, "2026-09-06T20:13:54.977Z old failure\n");
    const old = await readDaemonIncidentLogTail({ ...window, logPath });
    expect(old.lines).toEqual([]);
    expect(old.note).toBeNull();
    expect(old.window.excludedOutsideWindowLines).toBe(1);
    await expect(
      readDaemonIncidentLogTail({ ...window, logPath: root })
    ).rejects.toThrow();
  });

  it("bounds reads and keeps the newest complete timestamped evidence", async () => {
    const logPath = join(root, "large.log");
    await writeFile(
      logPath,
      `${"x".repeat(300_000)}\n2026-09-09T07:40:14.000Z current failure\n`
    );
    const result = await readDaemonIncidentLogTail({ ...window, logPath });
    expect(result.window.sourceTruncated).toBe(true);
    expect(result.lines).toEqual(["2026-09-09T07:40:14.000Z current failure"]);
  });
});

describe("operation correlation", () => {
  it("keeps the real filesystem error locally and projects path-free operation evidence", async () => {
    const targetPath = join(root, "Private.app", "Contents", "binary");
    let originalError: unknown;
    try {
      await runAuditedServiceManagerCarrierMutation({
        operation: "replace_stable_binary",
        distribution: "binary",
        targetPath,
        run: () => rename(join(root, "missing"), targetPath),
      });
    } catch (error) {
      originalError = error;
    }
    expect(originalError).toBeInstanceOf(Error);
    const failure = collectLocalOperationFailure(
      new Error("wrapped private text", {
        cause: originalError,
      })
    );
    expect(failure).toMatchObject({
      code: "ENOENT",
      syscall: "rename",
      pathCategory: "absolute_other",
      destinationCategory: "app_bundle",
    });
    const journal = (await readFile(daemonLifecycleJournalPath(), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(journal.at(-1)).toMatchObject({
      result: "failed",
      metadata: {
        targetPath,
        actorPid: process.pid,
        parentPid: process.ppid,
        operationFailure: failure,
      },
    });
    const now = new Date();
    const serialized = await collectPrepareStepDiagnostics({
      now,
      stepId: "refresh_service",
      supportCode: "prepare.refresh_service.failed",
      error: originalError,
      sources: {
        readLifecycleJournalTail: async () => [
          { ...journal[0], timestamp: "2026-09-06T00:00:00.000Z" },
          journal.at(-1),
        ],
        readServiceLogTail: async () => ({ lines: [], note: null }),
        readInventoryAnomalyCodes: async () => [],
        readServiceJobDiagnostics: async () => null,
        readDeviceId: async () => "test-device",
        readMacOSVersion: async () => ({
          productVersion: "26.6.2",
          buildVersion: "25G83",
        }),
      },
    });
    const bundle = JSON.parse(serialized ?? "");
    expect(bundle.operationFailure).toEqual(failure);
    expect(bundle.os).toMatchObject({
      productVersion: "26.6.2",
      buildVersion: "25G83",
    });
    expect(bundle.lifecycleJournalTail).toHaveLength(1);
    expect(bundle.lifecycleJournalTail[0].metadata).toMatchObject({
      operation: "replace_stable_binary",
      targetCategory: "app_bundle",
      actorPid: process.pid,
      parentPid: process.ppid,
      operationFailure: failure,
    });
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain("Private.app");
    expect(serialized).not.toContain("wrapped private text");
  });

  it("does not infer TCC from EPERM or copy arbitrary exception fields", () => {
    const error = Object.assign(new Error("private command"), {
      code: "EPERM",
      syscall: "spawn /private/program",
      path: "/Applications/Private.app/Contents/tool",
      spawnargs: ["secret"],
    });
    expect(collectLocalOperationFailure(error)).toEqual({
      code: "EPERM",
      pathCategory: "app_bundle",
    });
    expect(
      collectLocalOperationFailure(new Error("operation not permitted"))
    ).toBeUndefined();
  });
});

describe("macOS version diagnostics", () => {
  it("parses sw_vers product/build independently of Darwin release", () => {
    expect(
      parseMacOSVersion(
        "ProductName:\tmacOS\nProductVersion:\t26.6.2\nBuildVersion:\t25G83\n"
      )
    ).toEqual({ productVersion: "26.6.2", buildVersion: "25G83" });
    expect(() => parseMacOSVersion("ProductVersion: secret")).toThrow();
  });

  it("reads the current host using the bounded system command", async () => {
    const result = await readMacOSVersion();
    if (process.platform === "darwin") {
      expect(result?.productVersion).toMatch(PRODUCT_VERSION_PATTERN);
      expect(result?.buildVersion).toBeTruthy();
    } else {
      expect(result).toBeNull();
    }
  });
});
