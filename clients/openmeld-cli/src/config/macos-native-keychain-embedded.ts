import { createRequire } from "node:module";
import embeddedAddonPath from "../../native/macos-keychain/build/Release/openmeld_keychain.node" with {
  type: "file",
};

type MacOsKeychainAddon = {
  isParentSameExecutable(): boolean;
  read(service: string, account: string): string | null;
  remove(service: string, account: string): void;
  store(service: string, account: string, accessToken: string): void;
};

export function loadEmbeddedMacOsKeychainAddon(): MacOsKeychainAddon {
  return createRequire(import.meta.url)(
    embeddedAddonPath
  ) as MacOsKeychainAddon;
}
