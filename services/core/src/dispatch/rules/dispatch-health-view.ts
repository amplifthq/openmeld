import {
  emitHealthFinding,
  type HealthLogField,
} from "@openmeld/agent-runtime";
import type { CoreDispatchHealthFinding } from "./dispatch-health-contract";

export const emitCoreDispatchHealthFinding = (input: {
  eventName: string;
  fields?: Record<string, HealthLogField | undefined> | null;
  finding: CoreDispatchHealthFinding;
}): void => {
  emitHealthFinding({
    eventName: input.eventName,
    fields: input.fields,
    finding: input.finding,
    logSink: console,
  });
};
