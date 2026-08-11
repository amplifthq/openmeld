import type { DbFactTarget } from "@openmeld/schemas/types";
import { SHARED_DB_BINDING_NAME } from "./fact-metadata.ts";

export const buildSharedRuntimeDbTarget = (input: {
  bindingAvailable: boolean;
}): DbFactTarget => {
  return {
    targetKind: "worker_binding",
    bindingName: SHARED_DB_BINDING_NAME,
    databaseId: null,
    databaseName: null,
    localPath: null,
    resolvedFrom: input.bindingAvailable
      ? "runtime_binding_present"
      : "runtime_binding_missing",
  };
};
