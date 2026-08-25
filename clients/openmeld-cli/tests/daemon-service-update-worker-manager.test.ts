import { describe, expect, it, vi } from "vitest";

vi.mock("../src/local-service/lifecycle/daemon-service-command-spec", () => ({
  buildDaemonSystemServiceCommandSpec: vi.fn(),
}));
vi.mock("../src/local-service/lifecycle/daemon-service-bundle", () => ({
  resolveDaemonBundleEntryPathFromState: vi.fn(),
}));
vi.mock("../src/local-service/lifecycle/daemon-service-manager", () => ({
  resolveDaemonServiceManager: vi.fn(),
}));

import { resolveDaemonBundleEntryPathFromState } from "../src/local-service/lifecycle/daemon-service-bundle";
import { buildDaemonSystemServiceCommandSpec } from "../src/local-service/lifecycle/daemon-service-command-spec";
import { resolveDaemonServiceManager } from "../src/local-service/lifecycle/daemon-service-manager";
import type { DaemonServiceUpdateJob } from "../src/local-service/lifecycle/daemon-service-update-state";
import {
  buildDaemonServiceUpdateWorkerSpec,
  buildLaunchdServiceUpdateWorkerPlist,
  buildSystemdServiceUpdateWorkerPathUnit,
  buildSystemdServiceUpdateWorkerUnit,
} from "../src/local-service/lifecycle/daemon-service-update-worker-manager";

const SPEC = {
  args: ["service", "update-worker"],
  env: {
    OPENMELD_ENV_PRESET: "prod",
    OPENMELD_HOME: "/tmp/openmeld-home",
  },
  executable: "/tmp/openmeld-home/versions/0.3.98/openmeld",
  pendingJobPath: "/tmp/openmeld-home/runtime/state/service-update.json",
  workingDirectory: "/tmp/openmeld-home/runtime",
};

describe("daemon service update worker manager", () => {
  it("starts a binary update worker from the prepared version before replacing the stable carrier", async () => {
    const preparedExecutable = "/tmp/openmeld-home/versions/0.3.98/openmeld";
    vi.mocked(resolveDaemonServiceManager).mockResolvedValue({
      controller: "launchd",
    } as never);
    vi.mocked(buildDaemonSystemServiceCommandSpec).mockReturnValue({
      args: ["service", "run", "--mode", "foreground"],
      env: SPEC.env,
      executable:
        "/tmp/openmeld-home/runtime/daemon/service-manager/OpenMeld Service",
      workingDirectory: SPEC.workingDirectory,
    });
    vi.mocked(resolveDaemonBundleEntryPathFromState).mockResolvedValue(
      "/tmp/openmeld-home/runtime/daemon/service-manager/OpenMeld Service"
    );
    const job: DaemonServiceUpdateJob = {
      v: 2,
      schema: "openmeld-daemon-service-update-job-v2",
      attempts: 0,
      desiredState: "background",
      errorMessage: null,
      jobId: "stable-carrier-update",
      phase: "waiting_for_work",
      preparedBundle: {
        v: 2,
        schema: "openmeld-daemon-active-bundle-v2",
        bundleFormat: "binary_v1",
        bundleId: "binary-0.3.98",
        createdAt: "2026-08-25T00:00:00.000Z",
        daemonVersion: "0.3.98",
        entryScriptRelativePath: "openmeld",
        sourceDistFingerprint: "abc123",
        sourceDistRootPath: "/tmp/openmeld-home/versions/0.3.98",
        sourceEntryScriptPath: preparedExecutable,
        sourceKind: "package_install",
        sourcePackageRootPath: "/tmp/openmeld-home/versions/0.3.98",
        updatedAt: "2026-08-25T00:00:00.000Z",
      },
      requestedAt: "2026-08-25T00:00:00.000Z",
      requestSource: "cli",
      targetVersion: "0.3.98",
      updatedAt: "2026-08-25T00:00:00.000Z",
      urgency: "available",
    };

    await expect(
      buildDaemonServiceUpdateWorkerSpec(job)
    ).resolves.toMatchObject({
      args: ["service", "update-worker"],
      executable: preparedExecutable,
    });
    expect(resolveDaemonBundleEntryPathFromState).not.toHaveBeenCalled();
  });

  it("keeps the macOS worker alive only while a durable update is pending", () => {
    const plist = buildLaunchdServiceUpdateWorkerPlist({
      label: "com.openmeld.openmeld-service-update",
      logPath: "/tmp/openmeld-home/runtime/logs/service-update.log",
      spec: SPEC,
    });

    expect(plist).toContain(
      "<string>com.openmeld.openmeld-service-update</string>"
    );
    expect(plist).toContain("<key>PathState</key>");
    expect(plist).toContain(`<key>${SPEC.pendingJobPath}</key>`);
    expect(plist).toContain(`<string>${SPEC.executable}</string>`);
    expect(plist).toContain("<string>update-worker</string>");
    expect(plist).not.toContain("<key>KeepAlive</key>\n  <true/>");
  });

  it("lets systemd restart a crashed worker and resume it after reboot", () => {
    const unit = buildSystemdServiceUpdateWorkerUnit({
      spec: SPEC,
    });

    expect(unit).toContain(
      "ExecStart=/tmp/openmeld-home/versions/0.3.98/openmeld service update-worker"
    );
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("WantedBy=default.target");

    const pathUnit = buildSystemdServiceUpdateWorkerPathUnit({
      pendingJobPath: SPEC.pendingJobPath,
      serviceName: "openmeld-service-update",
    });
    expect(pathUnit).toContain(`PathExists=${SPEC.pendingJobPath}`);
    expect(pathUnit).toContain("Unit=openmeld-service-update.service");
    expect(pathUnit).toContain("WantedBy=default.target");
  });
});
