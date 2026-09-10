import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const PRODUCT_VERSION = /^ProductVersion:\s*([0-9]+(?:\.[0-9]+){1,3})\s*$/mu;
const BUILD_VERSION = /^BuildVersion:\s*([A-Za-z0-9.]+)\s*$/mu;

export function parseMacOSVersion(output: string): {
  productVersion: string;
  buildVersion: string;
} {
  const productVersion = PRODUCT_VERSION.exec(output)?.[1];
  const buildVersion = BUILD_VERSION.exec(output)?.[1];
  if (!(productVersion && buildVersion) || buildVersion.length > 64) {
    throw new Error("Invalid macOS version output");
  }
  return { productVersion, buildVersion };
}

export async function readMacOSVersion(): Promise<{
  productVersion: string;
  buildVersion: string;
} | null> {
  if (process.platform !== "darwin") {
    return null;
  }
  const { stdout } = await execute("/usr/bin/sw_vers", [], {
    timeout: 1500,
    maxBuffer: 4096,
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
  });
  return parseMacOSVersion(stdout);
}
