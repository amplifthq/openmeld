import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { isBinaryDistribution } from "../runtime/distribution";

type MacOsKeychainAddon = {
  read(service: string, account: string, accessGroup: string): string | null;
  remove(service: string, account: string, accessGroup: string): void;
  store(
    service: string,
    account: string,
    accessGroup: string,
    accessToken: string
  ): void;
};

type SecureStorageAddress = {
  accessGroup: string;
  account: string;
  service: string;
};

let loadedAddon: MacOsKeychainAddon | null = null;

export async function storeMacOsDataProtectionKeychainToken(
  input: SecureStorageAddress & { accessToken: string }
): Promise<void> {
  const addon = await loadAddon();
  addon.store(
    input.service,
    input.account,
    input.accessGroup,
    input.accessToken
  );
}

export async function readMacOsDataProtectionKeychainToken(
  input: SecureStorageAddress
): Promise<string | null> {
  const addon = await loadAddon();
  return addon.read(input.service, input.account, input.accessGroup);
}

export async function deleteMacOsDataProtectionKeychainToken(
  input: SecureStorageAddress
): Promise<void> {
  const addon = await loadAddon();
  addon.remove(input.service, input.account, input.accessGroup);
}

async function loadAddon(): Promise<MacOsKeychainAddon> {
  if (loadedAddon) {
    return loadedAddon;
  }
  if (process.platform !== "darwin") {
    throw new Error("macOS secure storage is only available on macOS");
  }

  if (isBinaryDistribution()) {
    const embedded = await import("./macos-data-protection-keychain-embedded");
    loadedAddon = embedded.loadEmbeddedMacOsKeychainAddon();
    return loadedAddon;
  }

  const require = createRequire(import.meta.url);
  const addonPath = fileURLToPath(
    new URL("./native/openmeld-keychain.node", import.meta.url)
  );
  loadedAddon = require(addonPath) as MacOsKeychainAddon;
  return loadedAddon;
}
