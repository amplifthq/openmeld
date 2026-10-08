import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildIcns,
  copyBrandAsset,
  repositoryRoot,
  resizeBrandAsset,
} from "../../../packages/ui/scripts/brand-assets.mjs";

const resources = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../resources"
);
const temporaryRoot = join(repositoryRoot, "dev-tmp");
mkdirSync(temporaryRoot, { recursive: true });
const temporary = mkdtempSync(join(temporaryRoot, "native-icons-"));
try {
  copyBrandAsset("openmeld-desktop-1024.png", join(resources, "icon.png"));
  copyBrandAsset(
    "openmeld-letter-o-mono-black-64.png",
    join(resources, "tray-icon.png")
  );
  const sizes = [16, 32, 64, 128, 256, 512, 1024];
  const icons = Object.fromEntries(
    sizes.map((size) => [
      size,
      size <= 128
        ? copyBrandAsset(
            `openmeld-desktop-${size}.png`,
            join(temporary, `${size}.png`)
          )
        : resizeBrandAsset(
            "openmeld-desktop-1024.png",
            size,
            join(temporary, `${size}.png`)
          ),
    ])
  );
  const iconset = {};
  for (const size of [16, 32, 128, 256, 512]) {
    iconset[`icon_${size}x${size}.png`] = icons[size];
    iconset[`icon_${size}x${size}@2x.png`] = icons[size * 2];
  }
  buildIcns(iconset, join(resources, "icon.icns"));
} finally {
  rmSync(temporary, { force: true, recursive: true });
}
console.log("Generated Desktop and tray icons from shared brand assets.");
