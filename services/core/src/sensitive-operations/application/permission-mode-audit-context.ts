import { AsyncLocalStorage } from "node:async_hooks";
import type { SensitiveOperationSourceKind } from "@openmeld/schemas";

// Trusted, request-local attribution. This carries no credential or permission
// authority; the Binding owner still validates and commits every change.
export type PermissionModeAuditAttribution = {
  actorUserId: string;
  organizationId: string;
  requestId: string;
  sourceKind: SensitiveOperationSourceKind;
  chainRootProfileId: string | null;
  taskExecutionId: string | null;
  confirmationId: string | null;
  onPermissionModeChangeCommitted?: () => void;
};

const attribution = new AsyncLocalStorage<PermissionModeAuditAttribution>();

export function withPermissionModeAuditAttribution<T>(
  value: PermissionModeAuditAttribution,
  run: () => Promise<T>
): Promise<T> {
  return attribution.run(value, run);
}

export function readPermissionModeAuditAttribution() {
  return attribution.getStore();
}
