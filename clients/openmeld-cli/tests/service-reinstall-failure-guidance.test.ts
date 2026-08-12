import { describe, expect, it } from "vitest";
import { buildDaemonReinstallFailureMessage } from "../src/commands/service-reinstall-view";

describe("service reinstall failure guidance", () => {
  it("gives a safe recovery path when the running Service control connection is missing", () => {
    expect(
      buildDaemonReinstallFailureMessage({
        action: "repair",
        backupDataPath: null,
        errorCode: "daemon.control.endpoint_missing",
        errorMessage:
          "controlled service drain failed: daemon control endpoint is missing",
        evidencePath: null,
        failureStage: "stop_or_drain",
        resolvedView: "human",
      })
    ).toBe(
      "OpenMeld Service repair could not safely stop the existing Service because its control connection is missing. Run `openmeld service status` to check for local Agent work. If none is running, run `openmeld service repair --force`. The force option stops the old Service process."
    );
  });

  it("keeps the stable error code and agent-safe recovery steps in diagnostics", () => {
    expect(
      buildDaemonReinstallFailureMessage({
        action: "update",
        backupDataPath: null,
        errorCode: "daemon.control.endpoint_missing",
        errorMessage:
          "controlled service drain failed: daemon control endpoint is missing",
        evidencePath: "/tmp/openmeld-service-evidence.jsonl",
        failureStage: "stop_or_drain",
        includeDiagnosticDetails: true,
        resolvedView: "agent",
      })
    ).toBe(
      "OpenMeld Service update failed: controlled service drain failed: daemon control endpoint is missing. Error code: daemon.control.endpoint_missing. Recovery: run `openmeld service status --view agent`. Only if no local Agent work is running, run `openmeld service update --force --view agent`. The force option stops the old Service process. Failure stage: stop_or_drain. Service evidence snapshot saved at /tmp/openmeld-service-evidence.jsonl."
    );
  });
});
