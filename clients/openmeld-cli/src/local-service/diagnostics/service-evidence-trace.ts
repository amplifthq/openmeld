import type {
  ReconcileAction,
  ReconcileDriftClass,
  ReconcileOwner,
  ReconcileSkipReason,
} from "@openmeld/local-service";
import { resolveOpenMeldEnvPreset } from "../../config/paths";

const SERVICE_EVIDENCE_TRACE_ENV = "OPENMELD_TRACE_DIAGNOSTICS";

export const shouldEmitServiceEvidenceTrace = (): boolean =>
  process.env[SERVICE_EVIDENCE_TRACE_ENV] === "1";

export const emitServiceEvidenceTrace = (
  category: "projection" | "reconcile",
  action: string,
  payload: Record<string, unknown>
): void => {
  if (!shouldEmitServiceEvidenceTrace()) {
    return;
  }
  console.info(`[openmeld.evidence.${category}.${action}]`, payload);
};

type ReconcileEvidencePayload = {
  action: ReconcileAction;
  driftClass: ReconcileDriftClass;
  foregroundActive: boolean;
  lifecycleLocked: boolean;
  owner: ReconcileOwner;
  skipReason: ReconcileSkipReason | null;
};

export function emitDriftDetectedEvidence(
  payload: ReconcileEvidencePayload & Record<string, unknown>
): void {
  emitStructuredReconcileEvidence("drift.detected", payload);
}

export function emitReconcileStartedEvidence(
  payload: ReconcileEvidencePayload & Record<string, unknown>
): void {
  emitStructuredReconcileEvidence("reconcile.started", payload);
}

export function emitReconcileSkippedEvidence(
  payload: ReconcileEvidencePayload & Record<string, unknown>
): void {
  emitStructuredReconcileEvidence("reconcile.skipped", payload);
}

export function emitReconcileCompletedEvidence(
  payload: ReconcileEvidencePayload & Record<string, unknown>
): void {
  emitStructuredReconcileEvidence("reconcile.completed", payload);
}

export function emitReconcileFailedEvidence(
  payload: ReconcileEvidencePayload & Record<string, unknown>
): void {
  emitStructuredReconcileEvidence("reconcile.failed", payload);
}

function emitStructuredReconcileEvidence(
  eventName:
    | "drift.detected"
    | "reconcile.completed"
    | "reconcile.failed"
    | "reconcile.skipped"
    | "reconcile.started",
  payload: ReconcileEvidencePayload & Record<string, unknown>
): void {
  emitServiceEvidenceTrace("reconcile", eventName, {
    lane: resolveOpenMeldEnvPreset(),
    ...payload,
  });
}
