import { localProjectControlDaemonFrameSchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { didLocalProjectConnectionsChange } from "../src/local-service/projects/local-project-activity-sync";

describe("Local Project Agent Activity sync", () => {
  it.each([
    [
      "connect_candidate",
      {
        bindingGeneration: "binding-1",
        canonicalPath: "/repo",
        isDefault: true,
        status: "connected",
      },
      true,
    ],
    [
      "connect_declared_path",
      {
        bindingGeneration: "binding-1",
        canonicalPath: "/repo",
        isDefault: true,
        status: "unchanged",
      },
      false,
    ],
    ["remove_connection", { connections: [], status: "removed" }, true],
    ["remove_connection", { connections: [], status: "unchanged" }, false],
    ["remove_missing_connections", { connections: [], removedCount: 2 }, true],
    ["remove_missing_connections", { connections: [], removedCount: 0 }, false],
    ["set_default_connection", { connections: [], status: "updated" }, true],
    ["set_default_connection", { connections: [], status: "unchanged" }, false],
  ] as const)("reports whether %s changed the authorized local connections", (operation, result, expected) => {
    const frame = localProjectControlDaemonFrameSchema.parse({
      code: `daemon.local_project_control.${operation}_result`,
      payload: { requestId: `request-${operation}`, result },
      v: 1,
    });

    expect(didLocalProjectConnectionsChange(frame)).toBe(expected);
  });
});
