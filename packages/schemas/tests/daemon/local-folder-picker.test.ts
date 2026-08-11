import { describe, expect, it } from "vitest";
import {
  localFolderPathSchema,
  localFolderPickerDaemonFrameSchema,
  localFolderPickerErrorCodeSchema,
  localFolderPickerHelperProtocolResultSchema,
  localFolderPickerHelperResultSchema,
  localFolderPickerRequestSchema,
  localFolderPickerResultSchema,
  localFolderPickerRuntimeCapabilitySchema,
  runtimeTransportBaseCapabilitiesSchema,
  runtimeTransportCapabilitiesSchema,
} from "../../src";

describe("Local Folder Picker contracts", () => {
  it("preserves valid absolute folder paths exactly", () => {
    expect(localFolderPathSchema.parse("/Users/felix/Project ")).toBe(
      "/Users/felix/Project "
    );
    expect(
      localFolderPathSchema.safeParse("C:\\Users\\felix\\Project")
    ).toMatchObject({ success: true });
    expect(localFolderPathSchema.safeParse("relative/project")).toMatchObject({
      success: false,
    });
  });

  it("uses one request shape across product purposes", () => {
    for (const purpose of [
      "computer_file_access",
      "project_connection",
      "agent_profile_working_folder",
    ] as const) {
      expect(
        localFolderPickerRequestSchema.safeParse({
          allowMultiple: purpose !== "agent_profile_working_folder",
          expectedDeviceId: "device-1",
          purpose,
        })
      ).toMatchObject({ success: true });
    }
    expect(
      localFolderPickerRequestSchema.safeParse({
        allowMultiple: true,
        expectedDeviceId: "device-1",
        purpose: "project_connection",
        path: "/private",
      })
    ).toMatchObject({ success: false });
  });

  it("distinguishes selection, cancellation, and strict unavailability", () => {
    expect(
      localFolderPickerResultSchema.safeParse({
        deviceId: "device-1",
        paths: ["/Users/felix/Project ", "/Users/felix/Second"],
        status: "selected",
      })
    ).toMatchObject({ success: true });
    expect(
      localFolderPickerResultSchema.safeParse({
        deviceId: "device-1",
        status: "cancelled",
      })
    ).toMatchObject({ success: true });
    expect(
      localFolderPickerResultSchema.safeParse({
        code: "local.folder_picker.no_interactive_session",
        message: "No signed-in desktop session is available on this computer.",
        status: "unavailable",
      })
    ).toMatchObject({ success: true });
    expect(
      localFolderPickerResultSchema.safeParse({
        code: "local.folder_picker.no_interactive_session",
        message: "Could not open /Users/felix/private.",
        path: "/Users/felix/private",
        status: "unavailable",
      })
    ).toMatchObject({ success: false });
  });

  it("uses one stable dotted failure-code family", () => {
    expect(localFolderPickerErrorCodeSchema.options).toEqual([
      "local.folder_picker.device_mismatch",
      "local.folder_picker.helper_missing",
      "local.folder_picker.internal_error",
      "local.folder_picker.invalid_request",
      "local.folder_picker.invalid_response",
      "local.folder_picker.no_interactive_session",
      "local.folder_picker.picker_busy",
      "local.folder_picker.portal_unavailable",
      "local.folder_picker.service_offline",
      "local.folder_picker.service_update_required",
      "local.folder_picker.timed_out",
      "local.folder_picker.unsupported_platform",
    ]);
  });

  it("owns the path-free subprocess protocol shared with the Service", () => {
    expect(
      localFolderPickerHelperProtocolResultSchema.safeParse({
        code: "local.folder_picker.internal_error",
        status: "unavailable",
        v: 1,
      }).success
    ).toBe(true);
    expect(
      localFolderPickerHelperProtocolResultSchema.safeParse({
        code: "local.folder_picker.internal_error",
        message: "/Users/felix/Secret Work",
        status: "unavailable",
        v: 1,
      }).success
    ).toBe(false);
    expect(
      localFolderPickerHelperResultSchema.safeParse({
        paths: ["/Users/felix/Design Work "],
        status: "selected",
      }).success
    ).toBe(true);
  });

  it("negotiates Folder Picker independently from existing capabilities", () => {
    expect(
      localFolderPickerRuntimeCapabilitySchema.safeParse({
        selectFolders: true,
      })
    ).toMatchObject({ success: true });
    expect(
      runtimeTransportCapabilitiesSchema.safeParse({
        localFolderPicker: { selectFolders: true },
      })
    ).toMatchObject({ success: true });
    expect(
      runtimeTransportCapabilitiesSchema.safeParse({
        computerFileAccess: { selectFolders: true },
      })
    ).toMatchObject({ success: false });
    expect(
      runtimeTransportBaseCapabilitiesSchema.safeParse({
        localFolderPicker: { selectFolders: true },
      })
    ).toMatchObject({ success: false });
  });

  it("keeps request and result frames strict", () => {
    expect(
      localFolderPickerDaemonFrameSchema.safeParse({
        code: "daemon.local_folder_picker.select_folders",
        payload: {
          request: {
            allowMultiple: true,
            expectedDeviceId: "device-1",
            purpose: "computer_file_access",
          },
          requestId: "request-1",
        },
        v: 1,
      })
    ).toMatchObject({ success: true });
    expect(
      localFolderPickerDaemonFrameSchema.safeParse({
        code: "daemon.local_folder_picker.select_folders_result",
        payload: {
          requestId: "request-1",
          result: {
            deviceId: "device-1",
            paths: ["/Users/felix/Project"],
            status: "selected",
          },
        },
        v: 1,
      })
    ).toMatchObject({ success: true });
  });
});
