import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { getDaemonSystemServiceLogPath } from "../src/local-service/lifecycle/daemon-service-manager";
import {
  captureDaemonStartFailureLogCursor,
  isDaemonStartFailureLikelyDependencyRequestFailure,
  readDaemonStartFailureLogDiagnostic,
  selectRelevantDaemonStartFailureLogLine,
  summarizeDaemonStartFailureLogLine,
} from "../src/local-service/lifecycle/daemon-start-failure-log";
import { withTempHome } from "./helpers/fs";

describe("local service start failure log diagnostics", () => {
  it("picks the last meaningful failure line from a noisy service log", () => {
    const rawLog = [
      "starting local service loop (gateway=http://localhost:8080)",
      "heartbeat ok; active leases=10",
      "error: no OpenMeld profile is selected for this terminal session yet",
    ].join("\n");

    expect(selectRelevantDaemonStartFailureLogLine(rawLog)).toBe(
      "error: no OpenMeld profile is selected for this terminal session yet"
    );
  });

  it("ignores presenter cards and box-drawing noise in the service log", () => {
    const rawLog = [
      "OPENMELD CLI • https://openmeld.ai",
      "People and agents, working as one.",
      "⚠️ OpenMeld Service Needs Repair ───────────────────────────────┐",
      "│  📝 Found: The OS service manager reports OpenMeld Service as running, but runtime state is not healthy. │",
      "⚠️ OpenMeld Service Update Required ────────────────────────────┐",
      "│  📝 Found: OpenMeld Service must be updated before it can start safely. │",
      "│  └──────────────────────────────────────────────────────  │",
      "│  ────────────────────────────────…                        │",
      "error: fetch failed",
    ].join("\n");

    expect(selectRelevantDaemonStartFailureLogLine(rawLog)).toBe(
      "error: fetch failed"
    );
  });

  it("returns null when the appended log only contains presenter chrome", () => {
    const rawLog = [
      "OPENMELD CLI • https://openmeld.ai",
      "People and agents, working as one.",
      "⚠️ OpenMeld Service Needs Attention ───────────────────────────┐",
      "│  📝 Found: OpenMeld could not finish starting OpenMeld Service.    │",
      "│  └────────────────────────────────────────────────────── │",
      "│  ────────────────────────────────…                       │",
      "└─────────────────────────────────────────────────────────┘",
    ].join("\n");

    expect(selectRelevantDaemonStartFailureLogLine(rawLog)).toBeNull();
  });

  it("maps known profile-selection failures into plain language", () => {
    expect(
      summarizeDaemonStartFailureLogLine(
        "error: no OpenMeld profile is selected for this terminal session yet"
      )
    ).toBe(
      "OpenMeld Service could not find a usable OpenMeld identity for this device."
    );
  });

  it("marks dependency request failures for follow-up diagnostics", () => {
    expect(
      isDaemonStartFailureLikelyDependencyRequestFailure("error: fetch failed")
    ).toBe(true);
    expect(
      isDaemonStartFailureLikelyDependencyRequestFailure(
        "Error: getaddrinfo ENOTFOUND gateway.openmeld.ai"
      )
    ).toBe(true);
    expect(
      isDaemonStartFailureLikelyDependencyRequestFailure(
        "Error: Cannot find module '/tmp/old-openmeld.js'"
      )
    ).toBe(false);
  });

  it("reads and summarizes the latest local service log", async () => {
    await withTempHome(async () => {
      const logPath = getDaemonSystemServiceLogPath();
      await mkdir(dirname(logPath), { recursive: true });
      await writeFile(
        logPath,
        [
          "starting local service loop (gateway=http://localhost:8080)",
          "error: Cannot find module '/tmp/old-openmeld.js'",
        ].join("\n"),
        "utf8"
      );

      await expect(readDaemonStartFailureLogDiagnostic()).resolves.toEqual({
        rawLine: "error: Cannot find module '/tmp/old-openmeld.js'",
        detail:
          "OpenMeld Service is still pointing at a local CLI file that no longer exists.",
      });
    });
  });

  it("ignores stale log history when a new start attempt writes nothing new", async () => {
    await withTempHome(async () => {
      const logPath = getDaemonSystemServiceLogPath();
      await mkdir(dirname(logPath), { recursive: true });
      await writeFile(
        logPath,
        "error: Cannot find module '/tmp/old-openmeld.js'\n",
        "utf8"
      );

      const cursor = await captureDaemonStartFailureLogCursor();

      await expect(
        readDaemonStartFailureLogDiagnostic({
          cursor,
        })
      ).resolves.toBeNull();
    });
  });

  it("summarizes only log content appended after the captured cursor", async () => {
    await withTempHome(async () => {
      const logPath = getDaemonSystemServiceLogPath();
      await mkdir(dirname(logPath), { recursive: true });
      await writeFile(
        logPath,
        "error: Cannot find module '/tmp/old-openmeld.js'\n",
        "utf8"
      );

      const cursor = await captureDaemonStartFailureLogCursor();
      await appendFile(
        logPath,
        "error: no OpenMeld profile is selected for this terminal session yet\n",
        "utf8"
      );

      await expect(
        readDaemonStartFailureLogDiagnostic({
          cursor,
        })
      ).resolves.toEqual({
        rawLine:
          "error: no OpenMeld profile is selected for this terminal session yet",
        detail:
          "OpenMeld Service could not find a usable OpenMeld identity for this device.",
      });
    });
  });

  it("maps missing package errors into a bundle dependency explanation", () => {
    expect(
      summarizeDaemonStartFailureLogLine(
        "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@clack/prompts' imported from /tmp/openmeld.js"
      )
    ).toBe("OpenMeld Service is missing a local dependency it needs to start.");
  });

  it("keeps generic dependency failure fallback wording lane-neutral", () => {
    expect(summarizeDaemonStartFailureLogLine("error: fetch failed")).toBe(
      "OpenMeld Service started locally, but an OpenMeld dependency request failed before startup completed."
    );
  });

  it("strips ANSI escapes before evaluating candidate log lines", () => {
    expect(
      selectRelevantDaemonStartFailureLogLine(
        "\u001B[31merror:\u001B[39m Cannot find module '/tmp/old-openmeld.js'"
      )
    ).toBe("error: Cannot find module '/tmp/old-openmeld.js'");
  });
});
