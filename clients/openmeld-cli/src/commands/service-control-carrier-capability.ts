import { resolve } from "node:path";
import { serviceControlCarrierCapabilitySchema } from "@openmeld/schemas";
import {
  CURRENT_PROCESS_START_IDENTITY,
  isPreciseProcessStartIdentity,
} from "../system/process-identity";

/** Describe this exact process before any repairing launcher or managed delegation. */
export function readServiceControlCarrierCapability() {
  if (process.platform !== "win32") {
    return serviceControlCarrierCapabilitySchema.parse({
      protocol: "account-checked-service-control-v1",
      executable: process.execPath,
    });
  }
  if (
    !(
      process.argv[1] &&
      isPreciseProcessStartIdentity(CURRENT_PROCESS_START_IDENTITY)
    )
  ) {
    throw new Error("Windows Service process identity could not be verified.");
  }
  return serviceControlCarrierCapabilitySchema.parse({
    protocol: "account-checked-service-control-v2",
    platform: "win32",
    executable: process.execPath,
    entryScript: resolve(process.argv[1]),
  });
}
