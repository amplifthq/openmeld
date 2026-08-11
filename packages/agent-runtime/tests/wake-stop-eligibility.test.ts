import { describe, expect, it } from "vitest";
import { resolveWakeStopEligibility } from "../src";

describe("Wake Stop eligibility", () => {
  it("uses native cancel when ACI advertises cancel support", () => {
    expect(
      resolveWakeStopEligibility({
        agentControllerInterface: {
          capabilities: buildCapabilities({ cancel: true, interrupt: true }),
        },
      })
    ).toEqual({
      controlMode: "cancel",
      reasonCode: null,
      reliability: "native_cancel",
      status: "eligible",
    });
  });

  it("uses native interrupt when ACI advertises interrupt-only support", () => {
    expect(
      resolveWakeStopEligibility({
        agentControllerInterface: {
          capabilities: buildCapabilities({ cancel: false, interrupt: true }),
        },
      })
    ).toEqual({
      controlMode: "interrupt",
      reasonCode: null,
      reliability: "native_interrupt",
      status: "eligible",
    });
  });

  it("fails closed when ACI is missing or Stop is unsupported", () => {
    expect(
      resolveWakeStopEligibility({ agentControllerInterface: null })
    ).toEqual({
      controlMode: null,
      reasonCode: "agent_controller_interface.missing",
      reliability: "unsupported",
      status: "not_eligible",
    });

    expect(
      resolveWakeStopEligibility({
        agentControllerInterface: {
          capabilities: buildCapabilities({ cancel: false, interrupt: false }),
        },
      })
    ).toEqual({
      controlMode: null,
      reasonCode: "agent_controller_interface.stop_unsupported",
      reliability: "unsupported",
      status: "not_eligible",
    });
  });
});

function buildCapabilities(input: { cancel: boolean; interrupt: boolean }) {
  return {
    approvals: false,
    cancel: input.cancel,
    interrupt: input.interrupt,
    modelSelection: false,
    nativeEventStream: false,
    permissionModes: false,
    structuredUserInput: false,
  };
}
