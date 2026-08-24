import { createRequire } from "node:module";
import embeddedAddonPath from "../../native/macos-keychain/build/Release/openmeld_keychain.node" with {
  type: "file",
};

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

export function loadEmbeddedMacOsKeychainAddon(): MacOsKeychainAddon {
  return createRequire(import.meta.url)(
    embeddedAddonPath
  ) as MacOsKeychainAddon;
}
