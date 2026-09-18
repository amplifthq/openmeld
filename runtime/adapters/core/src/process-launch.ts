import {
  type ChildProcess,
  type ExecFileException,
  type ExecFileOptions,
  execFile,
} from "node:child_process";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import {
  basename,
  dirname,
  extname,
  join,
  resolve,
  sep,
  win32,
} from "node:path";
import { promisify } from "node:util";
import { normalizeCommandEnvironment } from "./process-environment.js";

export type NativeCommandInvocation = {
  bin: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
};

const CMD_META_CHARACTERS = new Set('()[]%!^"`<>&|;, *?');
const BATCH_PATH_PATTERN = /\.(?:cmd|bat)$/iu;
const NODE_SCRIPT_PATTERN = /\.(?:cjs|mjs|js)$/iu;
const INVALID_BATCH_TEXT = /[\r\n\0]/u;
const SCRIPT_LINES = /\r?\n/u;
// npm/cmd-shim's Node wrapper. Only this complete control prefix is unwrapped;
// custom scripts keep their semantics through the escaped batch adapter below.
const NPM_NODE_SHIM_PREFIX = [
  "@echo off",
  "goto start",
  ":find_dp0",
  "set dp0=%~dp0",
  "exit /b",
  ":start",
  "setlocal",
  "call :find_dp0",
  'if exist "%dp0%\\node.exe" (',
  'set "_prog=%dp0%\\node.exe"',
  ") else (",
  'set "_prog=node"',
  "set pathext=%pathext:;.js;=;%",
  ")",
];
const NPM_NODE_SHIM_LAUNCH =
  /^endlocal & goto #_undefined_# 2>nul \|\| title %comspec% & "%_prog%"\s+"%dp0%[\\/]([^"\r\n]+)" %\*$/iu;

/** Native argv at the process boundary; callers never interpolate args into a shell. */
export function resolvePlatformCommand(
  file: string,
  args: readonly string[],
  source: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): NativeCommandInvocation {
  if (platform !== "win32") {
    return { bin: file, args: [...args] };
  }
  const env = normalizeCommandEnvironment(source, platform);
  const command = resolveWindowsCommandPath(file, env);
  const nodeScript = NODE_SCRIPT_PATTERN.test(command)
    ? command
    : readNpmNodeShimTarget(command);
  if (nodeScript) {
    return {
      bin: resolveWindowsNodeExecutable(dirname(command), env),
      args: [nodeScript, ...args],
    };
  }
  if (!BATCH_PATH_PATTERN.test(command)) {
    return { bin: command, args: [...args] };
  }
  if ([command, ...args].some((value) => INVALID_BATCH_TEXT.test(value))) {
    throw Object.assign(
      new Error(
        "This Windows batch wrapper cannot preserve multiline arguments. Select the native executable or Node script for this command."
      ),
      { code: "WINDOWS_BATCH_ARGUMENT_UNSUPPORTED" }
    );
  }
  // A batch entry reparses forwarded arguments (for example through %*) even
  // outside node_modules/.bin. Protect both cmd parsing layers, not just npm's
  // conventional shim directory. Native executables and recognized Node shims
  // above do not pass through either layer.
  const escapedArgs = args.map((value) => {
    const escaped = escapeCmdText(quoteWindowsProcessArgument(value));
    return escapeCmdText(escaped);
  });
  const statement = [
    escapeCmdText(win32.normalize(command)),
    ...escapedArgs,
  ].join(" ");
  if (statement.length > 8000) {
    throw Object.assign(
      new Error(
        "This Windows batch command is too long. Select its native executable or Node script instead."
      ),
      { code: "WINDOWS_BATCH_ARGUMENT_UNSUPPORTED" }
    );
  }
  const root = env.SystemRoot ?? env.WINDIR;
  if (!(root && win32.isAbsolute(root))) {
    throw new Error("Windows system directory is unavailable.");
  }
  return {
    bin: win32.join(root, "System32", "cmd.exe"),
    args: ["/d", "/v:off", "/s", "/c", `"${statement}"`],
    windowsVerbatimArguments: true,
  };
}

/** Windows CRT argv quoting, also used when CreateProcessW receives native argv. */
export function quoteWindowsProcessArgument(value: string): string {
  if (value.includes("\0")) {
    throw new Error("Process arguments must not contain a null byte.");
  }
  let quoted = '"';
  let slashes = 0;
  for (const char of value) {
    if (char === "\\") {
      slashes += 1;
      continue;
    }
    quoted += "\\".repeat(char === '"' ? slashes * 2 + 1 : slashes) + char;
    slashes = 0;
  }
  return `${quoted}${"\\".repeat(slashes * 2)}"`;
}

function escapeCmdText(value: string): string {
  return [...value]
    .map((char) => (CMD_META_CHARACTERS.has(char) ? `^${char}` : char))
    .join("");
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function resolveWindowsCommandPath(
  file: string,
  source: NodeJS.ProcessEnv = process.env
): string {
  if (file.includes("/") || file.includes("\\") || win32.isAbsolute(file)) {
    return file;
  }
  const env = normalizeCommandEnvironment(source, "win32");
  const extensions = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean)
    .map((item) => item.toLowerCase());
  const names = extname(file)
    ? [file]
    : [...extensions.map((extension) => `${file}${extension}`), file];
  for (const directory of (env.PATH ?? "").split(";").filter(Boolean)) {
    for (const name of names) {
      const candidate = join(directory, name);
      if (isFile(candidate)) {
        return candidate;
      }
    }
  }
  return file; // Preserve native ENOENT behavior when the selected command is missing.
}

function resolveWindowsNodeExecutable(
  directory: string,
  env: NodeJS.ProcessEnv
): string {
  const sibling = join(directory, "node.exe");
  if (isFile(sibling)) {
    return sibling;
  }
  const onPath = resolveWindowsCommandPath("node.exe", env);
  if (onPath !== "node.exe" && isFile(onPath)) {
    return onPath;
  }
  // Electron's executable is not the independent Node runtime needed by Service.
  if (
    !process.versions.electron &&
    basename(process.execPath).toLowerCase() === "node.exe"
  ) {
    return process.execPath;
  }
  throw Object.assign(
    new Error(
      "Node.js is required to run this Windows CLI. Install the supported Node.js release, then try again."
    ),
    { code: "NODE_RUNTIME_NOT_FOUND" }
  );
}

function readNpmNodeShimTarget(file: string): string | null {
  if (!BATCH_PATH_PATTERN.test(file)) {
    return null;
  }
  let descriptor: number | undefined;
  try {
    descriptor = openSync(file, "r");
    const buffer = Buffer.alloc(65_537);
    const size = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (size > 65_536) {
      return null;
    }
    const lines = buffer
      .subarray(0, size)
      .toString("utf8")
      .split(SCRIPT_LINES)
      .map((line) => line.trim())
      .filter(Boolean);
    if (
      lines.length !== NPM_NODE_SHIM_PREFIX.length + 1 ||
      !NPM_NODE_SHIM_PREFIX.every(
        (line, index) => lines[index]?.toLowerCase() === line
      )
    ) {
      return null;
    }
    const target = lines.at(-1)?.match(NPM_NODE_SHIM_LAUNCH)?.[1];
    if (!(target && NODE_SCRIPT_PATTERN.test(target)) || target.includes("%")) {
      return null;
    }
    return resolve(dirname(file), target.replaceAll("\\", sep));
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

type NativeExecCallback = (
  error: ExecFileException | null,
  stdout: string,
  stderr: string
) => void;

function executePlatformFile(
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
  callback: NativeExecCallback
): ChildProcess | undefined {
  try {
    const env = normalizeCommandEnvironment(options.env ?? process.env);
    const invocation = resolvePlatformCommand(file, args, env);
    return execFile(
      invocation.bin,
      invocation.args,
      {
        ...options,
        encoding: "utf8",
        env,
        ...(process.platform === "win32"
          ? {
              shell: false,
              windowsHide: true,
              windowsVerbatimArguments:
                invocation.windowsVerbatimArguments ?? false,
            }
          : {}),
      },
      callback
    );
  } catch (error) {
    const failure =
      error instanceof Error
        ? error
        : new Error("The native command could not be prepared.");
    queueMicrotask(() => callback(failure, "", ""));
    return undefined;
  }
}

function executePlatformFileAsync(
  file: string,
  args: readonly string[],
  options: ExecFileOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  if (process.platform !== "win32") {
    // Preserve Node's native promisify contract on platforms with no adapter.
    return promisify(execFile)(file, [...args], {
      ...options,
      encoding: "utf8",
    });
  }
  return new Promise((resolveResult, reject) => {
    executePlatformFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
      } else {
        resolveResult({ stdout, stderr });
      }
    });
  });
}

export const execPlatformFile = Object.assign(executePlatformFile, {
  [promisify.custom]: executePlatformFileAsync,
});
