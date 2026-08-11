import type { AuditEvent } from "@openmeld/gateway-contract";

export function logAuditEvent(event: AuditEvent): void {
  if (!shouldLogAuditEvent(event)) {
    return;
  }
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      service: "openmeld-gateway",
      ...event,
    })
  );
}

function shouldLogAuditEvent(event: AuditEvent): boolean {
  if (event.event === "http.forward") {
    return typeof event.status !== "number" || event.status >= 400;
  }
  if (event.event === "ws.open") {
    return false;
  }
  if (event.event === "ws.close") {
    return event.closeCode !== 1000 || event.reason !== "client_closed";
  }
  return true;
}
