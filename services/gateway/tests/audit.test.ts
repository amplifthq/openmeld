import { describe, expect, it, vi } from "vitest";
import { logAuditEvent } from "../src/audit";

describe("gateway audit logs", () => {
  it("does not print successful HTTP forward audit events", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logAuditEvent({
      event: "http.forward",
      method: "GET",
      requestId: "request-1",
      route: "/v1/profiles",
      status: 200,
    });

    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("prints failed HTTP forward audit events", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logAuditEvent({
      event: "http.forward",
      method: "GET",
      requestId: "request-1",
      route: "/v1/profiles",
      status: 500,
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
      event: "http.forward",
      method: "GET",
      requestId: "request-1",
      route: "/v1/profiles",
      service: "openmeld-gateway",
      status: 500,
    });
    logSpy.mockRestore();
  });

  it("does not print successful websocket open audit events", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logAuditEvent({
      event: "ws.open",
      method: "GET",
      requestId: "request-1",
      route: "/v1/daemon/stream",
    });

    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("does not print normal websocket close audit events", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logAuditEvent({
      closeCode: 1000,
      event: "ws.close",
      method: "GET",
      reason: "client_closed",
      requestId: "request-1",
      route: "/v1/daemon/stream",
    });

    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("prints abnormal websocket close audit events", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logAuditEvent({
      closeCode: 1011,
      event: "ws.close",
      method: "GET",
      reason: "upstream_send_failed",
      requestId: "request-1",
      route: "/v1/daemon/stream",
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
      closeCode: 1011,
      event: "ws.close",
      method: "GET",
      reason: "upstream_send_failed",
      requestId: "request-1",
      route: "/v1/daemon/stream",
      service: "openmeld-gateway",
    });
    logSpy.mockRestore();
  });
});
