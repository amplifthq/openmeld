import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { localFolderPickerHelperProtocolResultSchema } from "@openmeld/schemas";
import type {
  LocalFolderPickerHelperResult,
  LocalFolderPickerPurpose,
} from "@openmeld/schemas/types";
import { warnDaemonEvent } from "../core/logger";
import type { RunLocalFolderPickerHelper } from "./local-folder-picker-service";

const LOCAL_FOLDER_PICKER_TIMEOUT_MS = 590_000;
const LOCAL_FOLDER_PICKER_FORCE_KILL_DELAY_MS = 2000;
const MAX_HELPER_OUTPUT_BYTES = 256 * 1024;
const LINUX_PATH_SEPARATOR = "\u001e";
const LEADING_BYTE_ORDER_MARK_PATTERN = /^\uFEFF/;
const TERMINAL_LINE_BREAK_PATTERN = /\r?\n$/;

type ProcessResult = { exitCode: number; stdout: string };
type LocalFolderPickerHelperAdapter =
  | "linux_kdialog"
  | "linux_zenity"
  | "macos_jxa"
  | "windows_forms";
type LocalFolderPickerHelperDiagnosticCode =
  | "aborted"
  | "invalid_response"
  | "non_zero_exit"
  | "output_limit"
  | "spawn_failed"
  | "timed_out";
type LocalFolderPickerHelperDiagnostic = {
  adapter: LocalFolderPickerHelperAdapter;
  code: LocalFolderPickerHelperDiagnosticCode;
  exitCode?: number;
  platform: NodeJS.Platform;
};
type DiagnoseLocalFolderPickerHelper = (
  diagnostic: LocalFolderPickerHelperDiagnostic
) => void;
type InvokeHelper = (input: {
  args: string[];
  executablePath: string;
  signal: AbortSignal;
  stdin: string;
  timeoutMs: number;
}) => Promise<ProcessResult>;

type ResolveSystemPickerInput = {
  diagnose?: DiagnoseLocalFolderPickerHelper;
  env?: NodeJS.ProcessEnv;
  executableExists?: (path: string) => boolean;
  invoke?: InvokeHelper;
  platform?: NodeJS.Platform;
};

export function resolveSystemLocalFolderPickerHelper(
  input: ResolveSystemPickerInput = {}
): RunLocalFolderPickerHelper | null {
  const platform = input.platform ?? process.platform;
  const env = input.env ?? process.env;
  const executableExists = input.executableExists ?? isExecutable;
  const invoke = input.invoke ?? invokeLocalFolderPickerProcess;
  const diagnose = input.diagnose ?? emitLocalFolderPickerHelperDiagnostic;

  if (platform === "darwin") {
    const executablePath = "/usr/bin/osascript";
    return executableExists(executablePath)
      ? createJsonScriptPicker({
          args: ["-l", "JavaScript"],
          buildScript: buildMacOsPickerScript,
          diagnosticContext: {
            adapter: "macos_jxa",
            diagnose,
            platform,
          },
          executablePath,
          invoke,
        })
      : null;
  }

  if (platform === "win32") {
    const systemRoot = env.SystemRoot ?? env.WINDIR;
    if (!systemRoot) {
      return null;
    }
    const executablePath = join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    );
    return executableExists(executablePath)
      ? createJsonScriptPicker({
          args: [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-STA",
            "-Command",
            "-",
          ],
          buildScript: buildWindowsPickerScript,
          diagnosticContext: {
            adapter: "windows_forms",
            diagnose,
            platform,
          },
          executablePath,
          invoke,
        })
      : null;
  }

  if (platform === "linux") {
    const zenityPath = findExecutableOnPath(
      "zenity",
      env.PATH,
      executableExists
    );
    if (zenityPath) {
      return createZenityPicker({
        diagnosticContext: {
          adapter: "linux_zenity",
          diagnose,
          platform,
        },
        env,
        executablePath: zenityPath,
        invoke,
      });
    }
    const kdialogPath = findExecutableOnPath(
      "kdialog",
      env.PATH,
      executableExists
    );
    return kdialogPath
      ? createKDialogPicker({
          diagnosticContext: {
            adapter: "linux_kdialog",
            diagnose,
            platform,
          },
          env,
          executablePath: kdialogPath,
          invoke,
        })
      : null;
  }

  return null;
}

function createJsonScriptPicker(input: {
  args: string[];
  buildScript: (allowMultiple: boolean, prompt: string) => string;
  diagnosticContext: LocalFolderPickerHelperDiagnosticContext;
  executablePath: string;
  invoke: InvokeHelper;
}): RunLocalFolderPickerHelper {
  return async ({ allowMultiple, purpose, signal }) => {
    try {
      const processResult = await input.invoke({
        args: input.args,
        executablePath: input.executablePath,
        signal,
        stdin: input.buildScript(
          allowMultiple,
          resolveLocalFolderPickerPrompt(purpose, allowMultiple)
        ),
        timeoutMs: LOCAL_FOLDER_PICKER_TIMEOUT_MS,
      });
      if (processResult.exitCode !== 0) {
        diagnoseLocalFolderPickerHelper(input.diagnosticContext, {
          code: "non_zero_exit",
          exitCode: processResult.exitCode,
        });
        return internalError();
      }
      return parseJsonHelperResult(
        processResult.stdout,
        input.diagnosticContext
      );
    } catch (error) {
      return processFailureResult(error, input.diagnosticContext);
    }
  };
}

function createZenityPicker(input: {
  diagnosticContext: LocalFolderPickerHelperDiagnosticContext;
  env: NodeJS.ProcessEnv;
  executablePath: string;
  invoke: InvokeHelper;
}): RunLocalFolderPickerHelper {
  return async ({ allowMultiple, purpose, signal }) => {
    if (!hasLinuxDesktopSession(input.env)) {
      return noInteractiveSession();
    }
    try {
      const result = await input.invoke({
        args: [
          "--file-selection",
          "--directory",
          `--title=${resolveLocalFolderPickerPrompt(purpose, allowMultiple)}`,
          ...(allowMultiple
            ? ["--multiple", `--separator=${LINUX_PATH_SEPARATOR}`]
            : []),
        ],
        executablePath: input.executablePath,
        signal,
        stdin: "",
        timeoutMs: LOCAL_FOLDER_PICKER_TIMEOUT_MS,
      });
      if (result.exitCode === 1) {
        return { status: "cancelled" };
      }
      if (result.exitCode !== 0) {
        diagnoseLocalFolderPickerHelper(input.diagnosticContext, {
          code: "non_zero_exit",
          exitCode: result.exitCode,
        });
        return internalError();
      }
      return pathsFromLinuxOutput(
        result.stdout,
        LINUX_PATH_SEPARATOR,
        input.diagnosticContext
      );
    } catch (error) {
      return processFailureResult(error, input.diagnosticContext);
    }
  };
}

function createKDialogPicker(input: {
  diagnosticContext: LocalFolderPickerHelperDiagnosticContext;
  env: NodeJS.ProcessEnv;
  executablePath: string;
  invoke: InvokeHelper;
}): RunLocalFolderPickerHelper {
  return async ({ allowMultiple, purpose, signal }) => {
    if (!hasLinuxDesktopSession(input.env)) {
      return noInteractiveSession();
    }
    try {
      const result = await input.invoke({
        args: [
          "--getexistingdirectory",
          ".",
          "--title",
          resolveLocalFolderPickerPrompt(purpose, allowMultiple),
        ],
        executablePath: input.executablePath,
        signal,
        stdin: "",
        timeoutMs: LOCAL_FOLDER_PICKER_TIMEOUT_MS,
      });
      if (result.exitCode === 1) {
        return { status: "cancelled" };
      }
      if (result.exitCode !== 0) {
        diagnoseLocalFolderPickerHelper(input.diagnosticContext, {
          code: "non_zero_exit",
          exitCode: result.exitCode,
        });
        return internalError();
      }
      return pathsFromLinuxOutput(result.stdout, null, input.diagnosticContext);
    } catch (error) {
      return processFailureResult(error, input.diagnosticContext);
    }
  };
}

type LocalFolderPickerHelperDiagnosticContext = {
  adapter: LocalFolderPickerHelperAdapter;
  diagnose: DiagnoseLocalFolderPickerHelper;
  platform: NodeJS.Platform;
};

function parseJsonHelperResult(
  stdout: string,
  diagnosticContext: LocalFolderPickerHelperDiagnosticContext
): LocalFolderPickerHelperResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout.replace(LEADING_BYTE_ORDER_MARK_PATTERN, ""));
  } catch {
    diagnoseLocalFolderPickerHelper(diagnosticContext, {
      code: "invalid_response",
    });
    return invalidResponse();
  }
  const parsed = localFolderPickerHelperProtocolResultSchema.safeParse(raw);
  if (!parsed.success) {
    diagnoseLocalFolderPickerHelper(diagnosticContext, {
      code: "invalid_response",
    });
    return invalidResponse();
  }
  const { v: _version, ...result } = parsed.data;
  return result;
}

function pathsFromLinuxOutput(
  stdout: string,
  separator: string | null,
  diagnosticContext: LocalFolderPickerHelperDiagnosticContext
): LocalFolderPickerHelperResult {
  const output = stdout.replace(TERMINAL_LINE_BREAK_PATTERN, "");
  const rawPaths = separator ? output.split(separator) : [output];
  const parsed = localFolderPickerHelperProtocolResultSchema.safeParse({
    paths: rawPaths,
    status: "selected",
    v: 1,
  });
  if (!parsed.success || parsed.data.status !== "selected") {
    diagnoseLocalFolderPickerHelper(diagnosticContext, {
      code: "invalid_response",
    });
    return invalidResponse();
  }
  return { paths: parsed.data.paths, status: "selected" };
}

function processFailureResult(
  error: unknown,
  diagnosticContext: LocalFolderPickerHelperDiagnosticContext
): LocalFolderPickerHelperResult {
  const diagnosticCode = resolveProcessFailureDiagnosticCode(error);
  diagnoseLocalFolderPickerHelper(diagnosticContext, { code: diagnosticCode });
  if (diagnosticCode === "timed_out") {
    return {
      code: "local.folder_picker.timed_out",
      status: "unavailable",
    };
  }
  return internalError();
}

function resolveProcessFailureDiagnosticCode(
  error: unknown
): LocalFolderPickerHelperDiagnosticCode {
  if (!(error instanceof Error && "code" in error)) {
    return "spawn_failed";
  }
  switch (error.code) {
    case "LOCAL_FOLDER_PICKER_ABORTED":
      return "aborted";
    case "LOCAL_FOLDER_PICKER_OUTPUT_LIMIT":
      return "output_limit";
    case "LOCAL_FOLDER_PICKER_TIMEOUT":
      return "timed_out";
    default:
      return "spawn_failed";
  }
}

function diagnoseLocalFolderPickerHelper(
  context: LocalFolderPickerHelperDiagnosticContext,
  diagnostic: Pick<LocalFolderPickerHelperDiagnostic, "code" | "exitCode">
): void {
  context.diagnose({
    adapter: context.adapter,
    code: diagnostic.code,
    ...(diagnostic.exitCode === undefined
      ? {}
      : { exitCode: diagnostic.exitCode }),
    platform: context.platform,
  });
}

function emitLocalFolderPickerHelperDiagnostic(
  diagnostic: LocalFolderPickerHelperDiagnostic
): void {
  warnDaemonEvent("[openmeld.local_folder_picker.helper_failed]", {
    adapter: diagnostic.adapter,
    code: diagnostic.code,
    event: "cli.local_folder_picker.helper_failed",
    exitCode: diagnostic.exitCode,
    platform: diagnostic.platform,
  });
}

function invalidResponse(): LocalFolderPickerHelperResult {
  return {
    code: "local.folder_picker.invalid_response",
    status: "unavailable",
  };
}

function internalError(): LocalFolderPickerHelperResult {
  return {
    code: "local.folder_picker.internal_error",
    status: "unavailable",
  };
}

function noInteractiveSession(): LocalFolderPickerHelperResult {
  return {
    code: "local.folder_picker.no_interactive_session",
    status: "unavailable",
  };
}

function hasLinuxDesktopSession(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.WAYLAND_DISPLAY ||
      env.DISPLAY ||
      (env.DBUS_SESSION_BUS_ADDRESS && env.XDG_RUNTIME_DIR)
  );
}

function resolveLocalFolderPickerPrompt(
  purpose: LocalFolderPickerPurpose,
  allowMultiple: boolean
): string {
  if (purpose === "project_connection") {
    return "Choose a Project folder for OpenMeld";
  }
  if (purpose === "agent_profile_working_folder") {
    return "Choose a working folder for OpenMeld";
  }
  return allowMultiple
    ? "Choose folders for OpenMeld file access"
    : "Choose a folder for OpenMeld file access";
}

function findExecutableOnPath(
  executableName: string,
  pathValue: string | undefined,
  executableExists: (path: string) => boolean
): string | null {
  if (!pathValue) {
    return null;
  }
  for (const pathEntry of pathValue.split(delimiter)) {
    if (!pathEntry) {
      continue;
    }
    const candidate = join(pathEntry, executableName);
    if (executableExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function buildMacOsPickerScript(
  allowMultiple: boolean,
  prompt: string
): string {
  return `
ObjC.import("AppKit");
const nativeApp = $.NSApplication.sharedApplication;
nativeApp.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
nativeApp.activateIgnoringOtherApps(true);
const app = Application.currentApplication();
app.includeStandardAdditions = true;
try {
  const selection = app.chooseFolder({
    multipleSelectionsAllowed: ${allowMultiple ? "true" : "false"},
    withPrompt: ${JSON.stringify(prompt)}
  });
  const values = Array.isArray(selection) ? selection : [selection];
  JSON.stringify({ paths: values.map((value) => value.toString()), status: "selected", v: 1 });
} catch (error) {
  if (Number(error.errorNumber) === -128) {
    JSON.stringify({ status: "cancelled", v: 1 });
  } else {
    JSON.stringify({
      code: "local.folder_picker.internal_error",
      status: "unavailable",
      v: 1
    });
  }
}
`.trim();
}

function buildWindowsPickerScript(
  _allowMultiple: boolean,
  prompt: string
): string {
  return `
$ErrorActionPreference = "Stop"
try {
  $currentSession = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
  $hasExplorer = @(Get-Process -Name explorer -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $currentSession }).Count -gt 0
  if (-not $hasExplorer) {
    [Console]::Out.Write('{"code":"local.folder_picker.no_interactive_session","status":"unavailable","v":1}')
    exit 0
  }
  Add-Type -AssemblyName System.Windows.Forms
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = ${JSON.stringify(prompt)}
  $dialog.ShowNewFolderButton = $true
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    $result = @{ paths = @($dialog.SelectedPath); status = "selected"; v = 1 } | ConvertTo-Json -Compress
    [Console]::Out.Write($result)
  } else {
    [Console]::Out.Write('{"status":"cancelled","v":1}')
  }
} catch {
  [Console]::Out.Write('{"code":"local.folder_picker.internal_error","status":"unavailable","v":1}')
}
`.trim();
}

async function invokeLocalFolderPickerProcess(input: {
  args: string[];
  executablePath: string;
  signal: AbortSignal;
  stdin: string;
  timeoutMs: number;
}): Promise<ProcessResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.executablePath, input.args, {
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let terminationError: Error | null = null;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;

    const clearLifecycle = () => {
      clearTimeout(timeoutId);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      input.signal.removeEventListener("abort", onAbort);
    };
    const requestTermination = (error: Error) => {
      if (settled || terminationError) {
        return;
      }
      terminationError = error;
      try {
        child.kill();
      } catch {
        // The close/error lifecycle below remains the authority for settlement.
      }
      forceKillTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Keep waiting for close so the Service never admits a second picker
          // while the first helper may still be alive.
        }
      }, LOCAL_FOLDER_PICKER_FORCE_KILL_DELAY_MS);
    };
    const onAbort = () => {
      requestTermination(
        Object.assign(new Error("Local Folder Picker helper was stopped."), {
          code: "LOCAL_FOLDER_PICKER_ABORTED",
        })
      );
    };
    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }
      requestTermination(
        Object.assign(new Error("Local Folder Picker helper timed out."), {
          code: "LOCAL_FOLDER_PICKER_TIMEOUT",
        })
      );
    }, input.timeoutMs);
    input.signal.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_HELPER_OUTPUT_BYTES) {
        requestTermination(
          Object.assign(
            new Error("Local Folder Picker helper output was too large."),
            { code: "LOCAL_FOLDER_PICKER_OUTPUT_LIMIT" }
          )
        );
        return;
      }
      chunks.push(chunk);
    });
    child.once("error", (error) => {
      if (settled) {
        return;
      }
      terminationError ??= error;
    });
    child.once("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearLifecycle();
      if (terminationError) {
        reject(terminationError);
        return;
      }
      resolve({
        exitCode: exitCode ?? 1,
        stdout:
          outputBytes > MAX_HELPER_OUTPUT_BYTES
            ? ""
            : Buffer.concat(chunks).toString("utf8"),
      });
    });
    if (input.signal.aborted) {
      onAbort();
    }
    child.stdin.end(input.stdin);
  });
}
