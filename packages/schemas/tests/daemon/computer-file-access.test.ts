import { describe, expect, it } from "vitest";
import {
  computerFileAccessDaemonFrameSchema,
  computerFileAccessErrorCodeSchema,
  computerFileAccessPolicySchema,
  computerFileAccessUpdateRequestSchema,
  runtimeTransportBaseCapabilitiesSchema,
  runtimeTransportCapabilitiesSchema,
} from "../../src";

describe("Computer file access contracts", () => {
  it("uses one dotted machine-code family for file access failures", () => {
    expect(computerFileAccessErrorCodeSchema.options).toEqual([
      "computer.file_access.device_mismatch",
      "computer.file_access.internal_error",
      "computer.file_access.invalid_request",
      "computer.file_access.invalid_response",
      "computer.file_access.path_not_directory",
      "computer.file_access.path_not_found",
      "computer.file_access.path_unreadable",
      "computer.file_access.revision_mismatch",
      "computer.file_access.service_offline",
      "computer.file_access.service_update_required",
      "computer.file_access.timeout",
      "computer.file_access.unsupported",
    ]);
  });

  it("keeps the default mode free of a second folder state", () => {
    expect(
      computerFileAccessPolicySchema.safeParse({
        mode: "local_agent_settings",
        revision: 1,
        updatedAtMs: 1,
      })
    ).toMatchObject({ success: true });
    expect(
      computerFileAccessPolicySchema.safeParse({
        folders: ["/Users/felix/work"],
        mode: "local_agent_settings",
        revision: 1,
        updatedAtMs: 1,
      })
    ).toMatchObject({ success: false });
  });

  it.each([
    "only_selected_folders",
    "block_selected_folders",
  ] as const)("requires canonical absolute folders for %s", (mode) => {
    expect(
      computerFileAccessPolicySchema.safeParse({
        folders: ["/Users/felix/work"],
        mode,
        revision: 2,
        updatedAtMs: 2,
      })
    ).toMatchObject({ success: true });
    expect(
      computerFileAccessPolicySchema.safeParse({
        folders: ["relative/work"],
        mode,
        revision: 2,
        updatedAtMs: 2,
      })
    ).toMatchObject({ success: false });
    expect(
      computerFileAccessPolicySchema.safeParse({
        folders: [],
        mode,
        revision: 2,
        updatedAtMs: 2,
      })
    ).toMatchObject({ success: false });
  });

  it("binds updates to one expected Computer and an idempotency key", () => {
    expect(
      computerFileAccessUpdateRequestSchema.safeParse({
        expectedDeviceId: "device-1",
        expectedRevision: 1,
        idempotencyKey: "file-access-1",
        policy: {
          folders: ["/Users/felix/work"],
          mode: "only_selected_folders",
        },
      })
    ).toMatchObject({ success: true });
    expect(
      computerFileAccessUpdateRequestSchema.safeParse({
        expectedDeviceId: "device-1",
        expectedRevision: 0,
        idempotencyKey: "file-access-1",
        policy: { mode: "local_agent_settings" },
      })
    ).toMatchObject({ success: false });
  });

  it("advertises file access as a sibling current-Computer capability", () => {
    expect(
      runtimeTransportCapabilitiesSchema.safeParse({
        computerFileAccess: {
          readPolicy: true,
          updatePolicy: true,
        },
      })
    ).toMatchObject({ success: true });
    expect(
      runtimeTransportCapabilitiesSchema.safeParse({
        localProjectControl: { updateFileAccess: true },
      })
    ).toMatchObject({ success: false });
    expect(
      runtimeTransportBaseCapabilitiesSchema.safeParse({
        computerFileAccess: {
          readPolicy: true,
          updatePolicy: true,
        },
      })
    ).toMatchObject({ success: false });
  });

  it("keeps request and result frames strict", () => {
    expect(
      computerFileAccessDaemonFrameSchema.safeParse({
        code: "daemon.computer_file_access.read_policy",
        payload: {
          request: { expectedDeviceId: "device-1" },
          requestId: "request-1",
        },
        v: 1,
      })
    ).toMatchObject({ success: true });
    expect(
      computerFileAccessDaemonFrameSchema.safeParse({
        code: "daemon.computer_file_access.read_policy",
        payload: {
          request: { expectedDeviceId: "device-1", paths: ["/private"] },
          requestId: "request-1",
        },
        v: 1,
      })
    ).toMatchObject({ success: false });
  });
});
