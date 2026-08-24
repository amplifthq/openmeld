import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { isBinaryDistribution } from "../runtime/distribution";

type MacOsKeychainAddon = {
  read(service: string, account: string): string | null;
  remove(service: string, account: string): void;
  store(service: string, account: string, accessToken: string): void;
};

type KeychainAddress = {
  account: string;
  service: string;
};

let loadedAddon: MacOsKeychainAddon | null = null;

export async function storeMacOsNativeKeychainToken(
  input: KeychainAddress & { accessToken: string }
): Promise<void> {
  const addon = await loadAddon();
  addon.store(input.service, input.account, input.accessToken);
}

export async function readMacOsNativeKeychainToken(
  input: KeychainAddress
): Promise<string | null> {
  const addon = await loadAddon();
  return addon.read(input.service, input.account);
}

export async function deleteMacOsNativeKeychainToken(
  input: KeychainAddress
): Promise<void> {
  const addon = await loadAddon();
  addon.remove(input.service, input.account);
}

async function loadAddon(): Promise<MacOsKeychainAddon> {
  if (loadedAddon) {
    return loadedAddon;
  }
  if (process.platform !== "darwin") {
    throw new Error("macOS Keychain is only available on macOS");
  }

  if (isBinaryDistribution()) {
    const embedded = await import("./macos-native-keychain-embedded");
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
