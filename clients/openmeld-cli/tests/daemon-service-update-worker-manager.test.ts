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

import {
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
