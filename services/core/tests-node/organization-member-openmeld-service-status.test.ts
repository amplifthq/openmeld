import type { DaemonExecutionCompatibility } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveOrganizationMemberOpenMeldServiceState } from "../src/organizations/organization-member-openmeld-service-status";

const COMPATIBLE = {
  expectedEpoch: "runtime-contract-v1",
  observedEpoch: "runtime-contract-v1",
  reasonCode: "daemon.runtime_contract.compatible",
  status: "compatible",
} as const satisfies DaemonExecutionCompatibility;

const UPDATE_REQUIRED = {
  expectedEpoch: "runtime-contract-v2",
  observedEpoch: "runtime-contract-v1",
  reasonCode: "daemon.runtime_contract.mismatch",
  status: "update_required",
} as const satisfies DaemonExecutionCompatibility;

describe("Organization member OpenMeld Service status", () => {
  it("reports not connected without a fresh Service session", () => {
    expect(
      resolveOrganizationMemberOpenMeldServiceState({ sessions: [] })
    ).toBe("not_connected");
  });

  it("reports connected when at least one session is compatible and usable", () => {
    expect(
      resolveOrganizationMemberOpenMeldServiceState({
        sessions: [
          {
            executionCompatibility: UPDATE_REQUIRED,
            serviceUpdateWakeBlocked: true,
          },
          {
            executionCompatibility: COMPATIBLE,
            serviceUpdateWakeBlocked: false,
          },
        ],
      })
    ).toBe("connected");
  });

  it("reports needs attention when every fresh session is blocked", () => {
    expect(
      resolveOrganizationMemberOpenMeldServiceState({
        sessions: [
          {
            executionCompatibility: UPDATE_REQUIRED,
            serviceUpdateWakeBlocked: false,
          },
          {
            executionCompatibility: COMPATIBLE,
            serviceUpdateWakeBlocked: true,
          },
        ],
      })
    ).toBe("needs_attention");
  });
});
