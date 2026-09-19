import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  desktopProductionSourceSchema,
  resolveDesktopReleasePlatform,
} from "@openmeld/schemas";
import { MacUpdater, NsisUpdater } from "electron-updater";
import { parse as parseYaml } from "yaml";
import { verifyWindowsDesktopSignature } from "./windows-signature";
import { assertWindowsUpdaterConfiguration } from "./windows-updater-configuration";

export function createNativeDesktopUpdater(input: {
  resourcesPath: string;
  platform?: NodeJS.Platform;
  arch?: string;
}) {
  const platform = resolveDesktopReleasePlatform(
    input.platform ?? process.platform,
    input.arch ?? process.arch
  );
  if (!platform) {
    return null;
  }
  if (platform === "macos-arm64") {
    return { updater: new MacUpdater(), platform };
  }
  const read = (name: string) => {
    const content = readFileSync(join(input.resourcesPath, name), "utf8");
    if (content.length > 65_536) {
      throw new Error("Desktop update configuration is too large.");
    }
    return content;
  };
  const source = desktopProductionSourceSchema.parse(
    JSON.parse(read("desktop-production-source.json"))
  );
  const windows = assertWindowsUpdaterConfiguration({
    windows: source.windows,
    arch: input.arch ?? process.arch,
    configuration: parseYaml(read("app-update.yml"), { maxAliasCount: 0 }),
  });
  const updater = new NsisUpdater();
  updater.disableWebInstaller = true;
  updater.verifyUpdateCodeSignature = async (publishers, path) => {
    if (publishers.length !== 1 || publishers[0] !== windows.publisherName) {
      return "OpenMeld update publisher configuration changed.";
    }
    try {
      await verifyWindowsDesktopSignature(path, windows.publisherName);
      return null;
    } catch {
      return "Windows could not verify this OpenMeld update's signature and publisher.";
    }
  };
  return { updater, platform };
}
