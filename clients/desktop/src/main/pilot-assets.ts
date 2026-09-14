import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { desktopWebBuildSchema } from "@openmeld/schemas";

/** Shared by asset staging and native startup; a build marker alone is not a page. */
export function validatePilotAssets(directory: string, webBuild: string) {
  const assets = resolve(directory);
  try {
    const result = desktopWebBuildSchema.safeParse(
      JSON.parse(readFileSync(resolve(assets, "desktop-build.json"), "utf8"))
    );
    if (!result.success || result.data.webBuild !== webBuild) {
      throw new Error("Desktop page files do not match this native build.");
    }
    if (
      !(
        readFileSync(resolve(assets, "_shell.html"), "utf8").trim() &&
        statSync(resolve(assets, "assets")).isDirectory()
      )
    ) {
      throw new Error("Desktop shared page output is incomplete.");
    }
  } catch (cause) {
    throw new Error(
      "Desktop shared page files are missing, incomplete, or stale. Rebuild Web with OPENMELD_DESKTOP_PILOT=1, then rebuild Desktop from the same source.",
      { cause }
    );
  }
  return assets;
}

export function resolvePilotAssets(input: {
  privatePackage: boolean;
  resourcesPath: string;
  webBuild: string;
  env: NodeJS.ProcessEnv;
}) {
  if (input.privatePackage && input.env.OPENMELD_DESKTOP_PILOT !== "1") {
    throw new Error(
      "This private Desktop package requires the repo-root desktop:start:package command and an existing aligned local lane."
    );
  }
  if (input.env.OPENMELD_DESKTOP_PILOT !== "1") {
    return null;
  }
  const directory = input.privatePackage
    ? resolve(input.resourcesPath, "desktop-renderer")
    : input.env.OPENMELD_DESKTOP_RENDERER_DIR;
  return directory ? validatePilotAssets(directory, input.webBuild) : null;
}
