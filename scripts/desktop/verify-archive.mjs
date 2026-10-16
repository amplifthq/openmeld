import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";

const requireDesktop = createRequire(
  new URL("../../clients/desktop/package.json", import.meta.url)
);
const requireBuilder = createRequire(
  requireDesktop.resolve("electron-builder/package.json")
);
const requirePackager = createRequire(
  requireBuilder.resolve("app-builder-lib/package.json")
);
const asar = requirePackager("@electron/asar");
const LEADING_SEPARATOR = /^[/\\]/u;

// A valid OS signature can seal an internally corrupt archive. Validate the
// bytes against ASAR's own file index before signing or reusing a build.
export function verifyDesktopArchive(archive) {
  asar.uncache(archive);
  for (const entry of asar.listPackage(archive)) {
    const file = entry.replace(LEADING_SEPARATOR, "");
    const metadata = asar.statFile(archive, file, false);
    if (metadata.files || metadata.link) {
      continue;
    }
    const bytes = asar.extractFile(archive, file);
    if (
      bytes.length !== metadata.size ||
      metadata.integrity?.algorithm !== "SHA256" ||
      createHash("sha256").update(bytes).digest("hex") !==
        metadata.integrity.hash
    ) {
      throw new Error(
        `Desktop archive integrity failed for ${file}. Stop concurrent builds and rebuild Desktop before launching or publishing it.`
      );
    }
  }
  const manifest = JSON.parse(asar.extractFile(archive, "package.json"));
  if (typeof manifest.main !== "string" || !manifest.main) {
    throw new Error("Desktop archive has no main entry.");
  }
  asar.statFile(archive, manifest.main);
}

export default function verifyPackagedDesktopArchive(context) {
  const resources =
    context.electronPlatformName === "darwin"
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          "Contents",
          "Resources"
        )
      : join(context.appOutDir, "resources");
  verifyDesktopArchive(join(resources, "app.asar"));
}
