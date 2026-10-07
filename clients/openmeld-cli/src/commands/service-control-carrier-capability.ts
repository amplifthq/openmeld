import { resolve } from "node:path";
import { serviceControlCarrierCapabilitySchema } from "@openmeld/schemas";
import { isBinaryDistribution } from "../runtime/distribution";
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
  if (!isPreciseProcessStartIdentity(CURRENT_PROCESS_START_IDENTITY)) {
    throw new Error("Windows Service process identity could not be verified.");
  }
  if (isBinaryDistribution()) {
    return serviceControlCarrierCapabilitySchema.parse({
      protocol: "account-checked-service-control-v3",
      platform: "win32",
      executable: process.execPath,
    });
  }
  if (!process.argv[1]) {
    throw new Error("Windows Service entry script could not be verified.");
  }
  return serviceControlCarrierCapabilitySchema.parse({
    protocol: "account-checked-service-control-v2",
    platform: "win32",
    executable: process.execPath,
    entryScript: resolve(process.argv[1]),
  });
}
