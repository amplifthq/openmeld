import type { OpenMeldRequestContext } from "@openmeld/schemas/types";

export type AuditEventName =
  | "http.forward"
  | "http.forward.error"
  | "ws.open"
  | "ws.close"
  | "ws.reject";

export type AuditContextFields = {
  requestId: string;
  openMeldProfileId?: string;
  profileKind?: "human" | "agent" | "system";
};

export type AuditEvent = AuditContextFields & {
  event: AuditEventName;
  route?: string;
  method?: string;
  status?: number;
  latencyMs?: number;
  spaceId?: string;
  reason?: string;
  closeCode?: number;
  errorCode?: string;
};

export function contextAuditFields(
  context: OpenMeldRequestContext
): AuditContextFields {
  return {
    requestId: context.actorContext.requestId,
    openMeldProfileId: context.actorContext.openMeldProfileId,
    profileKind: context.actorContext.profileKind,
  };
}
