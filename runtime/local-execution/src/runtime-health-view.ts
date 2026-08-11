import {
  emitHealthFinding,
  type HealthLogField,
} from "@openmeld/agent-runtime";
import type { RuntimeHealthFinding } from "./runtime-health-contract.js";

export const emitRuntimeHealthFinding = (input: {
  eventName: string;
  fields?: Record<string, HealthLogField | undefined> | null;
  finding: RuntimeHealthFinding;
}): void => {
  emitHealthFinding({
    eventName: input.eventName,
    fields: input.fields,
    finding: input.finding,
  });
};
