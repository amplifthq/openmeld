import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { isLoopbackHostname } from "./loopback-hostname";
import { resolveOpenMeldEnvPreset } from "./paths";

/** Select only newly issued localhost credentials; never migrate saved tokens. */
export async function shouldUseDevelopmentCredentialFile(
  authBaseUrl: string
): Promise<boolean> {
  if (
    process.platform !== "darwin" ||
    resolveOpenMeldEnvPreset() !== "dev-local"
  ) {
    return false;
  }
  const mode = process.env.OPENMELD_DEV_CREDENTIAL_STORE;
  if (mode === "system") {
    return false;
  }
  if (mode && mode !== "file") {
    throw new Error("OPENMELD_DEV_CREDENTIAL_STORE must be file or system.");
  }
  const root = process.env.OPENMELD_HOME?.trim();
  if (!(root && isAbsolute(root))) {
    return false;
  }
  if (
    !(
      isLocalEndpoint(authBaseUrl) &&
      isLocalEndpoint(process.env.OPENMELD_GATEWAY_URL)
    )
  ) {
    return false;
  }
  const canonicalRoot = await canonicalPath(root);
  const userHome = await canonicalPath(homedir());
  if (canonicalRoot === userHome || canonicalRoot === dirname(canonicalRoot)) {
    return false;
  }
  for (const directory of [".openmeld", ".openmeld-dev", ".openmeld-canary"]) {
    const protectedRoot = await canonicalPath(join(userHome, directory));
    if (
      canonicalRoot === protectedRoot ||
      canonicalRoot.startsWith(protectedRoot + sep)
    ) {
      return false;
    }
  }
  return true;
}

function isLocalEndpoint(value: string | undefined): boolean {
  try {
    const url = new URL(value ?? "");
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      (isLoopbackHostname(url.hostname) || url.hostname.endsWith(".localhost"))
    );
  } catch {
    return false;
  }
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    const absolute = resolve(path);
    const parent = dirname(absolute);
    if (parent === absolute) {
      throw error;
    }
    return join(await canonicalPath(parent), basename(absolute));
  }
}
