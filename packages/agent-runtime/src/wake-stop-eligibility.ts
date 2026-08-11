import type { AgentControllerInterfaceSnapshot } from "@openmeld/schemas/types";

export type WakeStopEligibilityControlMode = "cancel" | "interrupt";

export type WakeStopEligibility =
  | {
      controlMode: "cancel";
      reasonCode: null;
      reliability: "native_cancel";
      status: "eligible";
    }
  | {
      controlMode: "interrupt";
      reasonCode: null;
      reliability: "native_interrupt";
      status: "eligible";
    }
  | {
      controlMode: null;
      reasonCode:
        | "agent_controller_interface.missing"
        | "agent_controller_interface.stop_unsupported";
      reliability: "unsupported";
      status: "not_eligible";
    };

export function resolveWakeStopEligibility(input: {
  agentControllerInterface?: Pick<
    AgentControllerInterfaceSnapshot,
    "capabilities"
  > | null;
}): WakeStopEligibility {
  const capabilities = input.agentControllerInterface?.capabilities ?? null;
  if (!capabilities) {
    return {
      controlMode: null,
      reasonCode: "agent_controller_interface.missing",
      reliability: "unsupported",
      status: "not_eligible",
    };
  }
  if (capabilities.cancel) {
    return {
      controlMode: "cancel",
      reasonCode: null,
      reliability: "native_cancel",
      status: "eligible",
    };
  }
  if (capabilities.interrupt) {
    return {
      controlMode: "interrupt",
      reasonCode: null,
      reliability: "native_interrupt",
      status: "eligible",
    };
  }
  return {
    controlMode: null,
    reasonCode: "agent_controller_interface.stop_unsupported",
    reliability: "unsupported",
    status: "not_eligible",
  };
}
