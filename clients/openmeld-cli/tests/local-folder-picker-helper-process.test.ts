import { describe, expect, it, vi } from "vitest";
import { resolveSystemLocalFolderPickerHelper } from "../src/local-service/folder-picker/local-folder-picker-helper-process";

describe("Local Folder Picker system helper", () => {
  it("opens the macOS dialog without placing user paths in command arguments", async () => {
    const invoke = vi.fn().mockResolvedValue({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({
        paths: ["/Users/felix/Design Work"],
        status: "selected",
        v: 1,
      }),
    });
    const run = resolveSystemLocalFolderPickerHelper({
      executableExists: () => true,
      invoke,
      platform: "darwin",
    });

    await expect(
      run?.({
        allowMultiple: true,
        purpose: "computer_file_access",
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({
      paths: ["/Users/felix/Design Work"],
      status: "selected",
    });
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["-l", "JavaScript"],
        executablePath: "/usr/bin/osascript",
        stdin: expect.stringContaining("multipleSelectionsAllowed: true"),
        timeoutMs: 590_000,
      })
    );
    const script = String(invoke.mock.calls[0]?.[0]?.stdin ?? "");
    expect(script).toContain('ObjC.import("AppKit");');
    expect(script).toContain(
      "nativeApp.setActivationPolicy($.NSApplicationActivationPolicyAccessory);"
    );
    expect(script).toContain("nativeApp.activateIgnoringOtherApps(true);");
    expect(
      script.indexOf("nativeApp.activateIgnoringOtherApps(true);")
    ).toBeLessThan(script.indexOf("app.chooseFolder"));
    expect(JSON.stringify(invoke.mock.calls[0]?.[0]?.args)).not.toContain(
      "/Users/felix/Design Work"
    );
  });

  it("keeps closing the macOS dialog as a quiet cancellation", async () => {
    const invoke = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: '{"status":"cancelled","v":1}',
    });
    const run = resolveSystemLocalFolderPickerHelper({
      executableExists: () => true,
      invoke,
      platform: "darwin",
    });

    await expect(
      run?.({
        allowMultiple: false,
        purpose: "project_connection",
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({
      status: "cancelled",
    });
    expect(invoke.mock.calls[0]?.[0]?.stdin).toContain(
      'withPrompt: "Choose a Project folder for OpenMeld"'
    );
  });

  it("uses the signed-in Windows session and keeps selected paths out of arguments", async () => {
    const invoke = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout:
        '{"paths":["C:\\\\Users\\\\Felix\\\\Design Work"],"status":"selected","v":1}',
    });
    const run = resolveSystemLocalFolderPickerHelper({
      env: { SystemRoot: "C:\\Windows" },
      executableExists: () => true,
      invoke,
      platform: "win32",
    });

    await expect(
      run?.({
        allowMultiple: false,
        purpose: "agent_profile_working_folder",
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({
      paths: ["C:\\Users\\Felix\\Design Work"],
      status: "selected",
    });
    expect(invoke.mock.calls[0]?.[0]).toMatchObject({
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-STA",
        "-Command",
        "-",
      ],
      executablePath:
        "C:\\Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    });
  });

  it("preserves a legal trailing space returned by a Linux folder dialog", async () => {
    const invoke = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: "/home/felix/Design Work \n",
    });
    const run = resolveSystemLocalFolderPickerHelper({
      env: { DISPLAY: ":0", PATH: "/usr/bin" },
      executableExists: (path) => path === "/usr/bin/zenity",
      invoke,
      platform: "linux",
    });

    await expect(
      run?.({
        allowMultiple: false,
        purpose: "project_connection",
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({
      paths: ["/home/felix/Design Work "],
      status: "selected",
    });
  });

  it("does not advertise Linux support without a desktop dialog provider", () => {
    expect(
      resolveSystemLocalFolderPickerHelper({
        env: { DISPLAY: ":0", PATH: "/usr/bin" },
        executableExists: () => false,
        platform: "linux",
      })
    ).toBeNull();
  });

  it("keeps Linux capability available while a signed-in desktop session is temporarily absent", async () => {
    const run = resolveSystemLocalFolderPickerHelper({
      env: { PATH: "/usr/bin" },
      executableExists: (path) => path === "/usr/bin/zenity",
      invoke: vi.fn(),
      platform: "linux",
    });

    await expect(
      run?.({
        allowMultiple: false,
        purpose: "project_connection",
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({
      code: "local.folder_picker.no_interactive_session",
      status: "unavailable",
    });
  });

  it("never forwards process stderr or selected paths into remote errors", async () => {
    const selectedPath = "/Users/felix/Secret Work";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const run = resolveSystemLocalFolderPickerHelper({
      executableExists: () => true,
      invoke: vi.fn().mockResolvedValue({
        exitCode: 1,
        stderr: `native failure near ${selectedPath}`,
        stdout: "",
      }),
      platform: "darwin",
    });

    const result = await run?.({
      allowMultiple: false,
      purpose: "computer_file_access",
      signal: new AbortController().signal,
    });
    expect(result).toEqual({
      code: "local.folder_picker.internal_error",
      status: "unavailable",
    });
    expect(JSON.stringify(result)).not.toContain(selectedPath);
    const localDiagnostic = warn.mock.calls.flat().join("\n");
    expect(localDiagnostic).toContain(
      "[openmeld.local_folder_picker.helper_failed]"
    );
    expect(localDiagnostic).toContain('"adapter":"macos_jxa"');
    expect(localDiagnostic).toContain('"code":"non_zero_exit"');
    expect(localDiagnostic).toContain('"exitCode":1');
    expect(localDiagnostic).toContain('"platform":"darwin"');
    expect(localDiagnostic).not.toContain(selectedPath);
    warn.mockRestore();
  });

  it("maps a process timeout to a stable path-free result", async () => {
    const diagnose = vi.fn();
    const run = resolveSystemLocalFolderPickerHelper({
      diagnose,
      executableExists: () => true,
      invoke: vi.fn().mockRejectedValue(
        Object.assign(new Error("timed out"), {
          code: "LOCAL_FOLDER_PICKER_TIMEOUT",
        })
      ),
      platform: "darwin",
    });

    await expect(
      run?.({
        allowMultiple: false,
        purpose: "computer_file_access",
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({
      code: "local.folder_picker.timed_out",
      status: "unavailable",
    });
    expect(diagnose).toHaveBeenCalledWith({
      adapter: "macos_jxa",
      code: "timed_out",
      platform: "darwin",
    });
  });

  it.each([
    ["LOCAL_FOLDER_PICKER_ABORTED", "aborted"],
    ["LOCAL_FOLDER_PICKER_OUTPUT_LIMIT", "output_limit"],
    ["ENOENT", "spawn_failed"],
  ] as const)("keeps %s failure details local as stable diagnostic code %s", async (processCode, diagnosticCode) => {
    const selectedPath = "/Users/felix/Secret Work";
    const diagnose = vi.fn();
    const run = resolveSystemLocalFolderPickerHelper({
      diagnose,
      executableExists: () => true,
      invoke: vi.fn().mockRejectedValue(
        Object.assign(new Error(`native failure near ${selectedPath}`), {
          code: processCode,
        })
      ),
      platform: "darwin",
    });

    const result = await run?.({
      allowMultiple: false,
      purpose: "computer_file_access",
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      code: "local.folder_picker.internal_error",
      status: "unavailable",
    });
    expect(diagnose).toHaveBeenCalledWith({
      adapter: "macos_jxa",
      code: diagnosticCode,
      platform: "darwin",
    });
    expect(JSON.stringify(diagnose.mock.calls)).not.toContain(selectedPath);
  });
});
