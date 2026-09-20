import { describe, expect, it } from "vitest";
import { RUNTIME_TRANSPORT_SCHEMA_VERSION } from "../src/schemas/daemon/runtime-transport";
import {
  SERVICE_EXECUTION_HOST_PROTOCOL,
  serviceExecutionHostCatalogSchema,
  serviceExecutionHostMessageSchema,
  serviceExecutionHostMethods,
  serviceExecutionHostRequestSchema,
} from "../src/service-execution-host";

describe("execution host process boundary", () => {
  it.each([
    "daemon.session.register",
    "daemon.session.heartbeat",
    "daemon.openmeld_tools_control.request",
    "daemon.local_project_control.connect_declared_path",
  ])("does not let execution IPC impersonate %s", (code) => {
    expect(
      serviceExecutionHostMethods.handleFrame.input.safeParse({
        connectionGeneration: 1,
        frame: { v: RUNTIME_TRANSPORT_SCHEMA_VERSION, code, payload: {} },
      }).success
    ).toBe(false);
  });

  it("rejects unsupported protocols, generic commands and caller-selected destinations", () => {
    const request = {
      protocol: SERVICE_EXECUTION_HOST_PROTOCOL,
      hostInstanceId: "ab20e7bb-7387-4181-864b-775560aa4b42",
      requestId: "bb20e7bb-7387-4181-864b-775560aa4b42",
      method: "health",
      payload: {},
    };
    expect(serviceExecutionHostRequestSchema.safeParse(request).success).toBe(
      true
    );
    expect(
      serviceExecutionHostRequestSchema.safeParse({
        ...request,
        protocol: "v0",
      }).success
    ).toBe(false);
    expect(
      serviceExecutionHostRequestSchema.safeParse({
        ...request,
        method: "executeShell",
      }).success
    ).toBe(false);
    expect(
      serviceExecutionHostRequestSchema.safeParse({
        ...request,
        endpoint: "http://localhost:9000",
      }).success
    ).toBe(false);
    expect(
      serviceExecutionHostMethods.health.input.safeParse({ path: "/private" })
        .success
    ).toBe(false);
    expect(
      serviceExecutionHostMethods.configureConnection.input.safeParse({
        connectionGeneration: 1,
        catalogRevision: 0,
        leases: [],
        routes: [{ executable: "/other/program" }],
      }).success
    ).toBe(false);
  });

  it("keeps ordinary Activity sync compatible and validates explicit integration refresh", () => {
    const schema = serviceExecutionHostMethods.syncActivity.input;
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ refreshIntegrations: true })).toEqual({
      refreshIntegrations: true,
    });
    expect(schema.safeParse({ refreshIntegrations: "true" }).success).toBe(
      false
    );
    expect(
      schema.safeParse({ refreshIntegrations: true, rootDir: "/other-lane" })
        .success
    ).toBe(false);
  });

  it("rejects host output that claims to register or heartbeat the Computer", () => {
    for (const code of [
      "daemon.session.register",
      "daemon.session.heartbeat",
      "daemon.dispatch.lifecycle_acknowledged",
    ]) {
      expect(
        serviceExecutionHostMessageSchema.safeParse({
          protocol: SERVICE_EXECUTION_HOST_PROTOCOL,
          hostInstanceId: "ab20e7bb-7387-4181-864b-775560aa4b42",
          type: "frame",
          connectionGeneration: 1,
          frame: { v: RUNTIME_TRANSPORT_SCHEMA_VERSION, code, payload: {} },
        }).success
      ).toBe(false);
    }
  });

  it("allows an empty inventory but rejects a catalog that silently loses its routes", () => {
    const empty = {
      revision: 1,
      profileIds: [],
      routes: [],
      skippedProfiles: [],
    };
    expect(serviceExecutionHostCatalogSchema.safeParse(empty).success).toBe(
      true
    );
    expect(
      serviceExecutionHostCatalogSchema.safeParse({
        ...empty,
        profileIds: ["missing-profile"],
      }).success
    ).toBe(false);
  });
});
