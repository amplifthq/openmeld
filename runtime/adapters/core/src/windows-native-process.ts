import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WINDOWS_PROCESS_HELPER_FILENAME } from "@openmeld/schemas";

// Injected by the CLI packager. Node/npm and source consumers use the package
// asset; compiled artifacts use the helper shipped in the same version bundle.
declare const __OPENMELD_DISTRIBUTION__: string | undefined;

export const WINDOWS_NATIVE_PROCESS_REQUEST_ENV = "OPENMELD_NATIVE_JOB_REQUEST";

export function resolveWindowsNativeProcessHelper(): string {
  const binary =
    typeof __OPENMELD_DISTRIBUTION__ !== "undefined" &&
    __OPENMELD_DISTRIBUTION__ === "binary";
  return binary
    ? join(dirname(process.execPath), WINDOWS_PROCESS_HELPER_FILENAME)
    : fileURLToPath(
        // Both src/ (workspace tests) and dist/ (installed code) share this
        // package-owned build output. Never search another installation.
        new URL(
          `../dist/windows/${WINDOWS_PROCESS_HELPER_FILENAME}`,
          import.meta.url
        )
      );
}
