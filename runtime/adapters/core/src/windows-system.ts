import { win32 } from "node:path";
import { normalizeCommandEnvironment } from "./process-environment.js";

export function resolveWindowsPowerShellPath(
  env: NodeJS.ProcessEnv = process.env
): string {
  const source = normalizeCommandEnvironment(env, "win32");
  const root = source.SystemRoot ?? source.WINDIR;
  if (!(root && win32.isAbsolute(root))) {
    throw new Error("Windows system directory is unavailable.");
  }
  return win32.join(
    root,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
}

export function powerShellEncodedArguments(script: string): string[] {
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ];
}
