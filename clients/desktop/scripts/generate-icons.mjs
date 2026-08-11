import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildIcns,
  renderMasterComposedPng,
  renderSimplePng,
} from "../../web/scripts/logo-pipeline.mjs";

// Regenerates the Electron app + tray icons from the single logo source of
// truth. The dock/window icon and the large .icns layers use the ENLARGED glow
// master (W scaled up so it reads big in the dock); the small .icns layers and
// the menu-bar tray use the legible SIMPLE variant. SVG intermediates retired.

const here = dirname(fileURLToPath(import.meta.url));
const resourcesDir = resolve(here, "..", "resources");
const tmp = tmpdir();

// Dock / window icon: enlarged glow master (W ~170% vs the padded web master,
// so it does not read tiny in the dock).
renderMasterComposedPng(1024, join(resourcesDir, "icon.png"));

// macOS menu-bar tray: single-colour template image (black W on transparent).
// Electron auto-inverts it for light/dark menu bars — NOT the glow version.
renderSimplePng(64, join(resourcesDir, "tray-icon.png"), {
  content: 0.82,
  color: "#000000",
  bg: "transparent",
});

// .icns iconset: small layers = simple (legible), large layers = enlarged glow.
const s16 = renderSimplePng(16, join(tmp, "openmeld-icns-16.png"), {
  content: 0.86,
});
const s32 = renderSimplePng(32, join(tmp, "openmeld-icns-32.png"), {
  content: 0.82,
});
const s64 = renderSimplePng(64, join(tmp, "openmeld-icns-64.png"), {
  content: 0.8,
});
const s128 = renderSimplePng(128, join(tmp, "openmeld-icns-128.png"), {
  content: 0.74,
});
const m256 = renderMasterComposedPng(256, join(tmp, "openmeld-icns-256.png"));
const m512 = renderMasterComposedPng(512, join(tmp, "openmeld-icns-512.png"));
const m1024 = renderMasterComposedPng(
  1024,
  join(tmp, "openmeld-icns-1024.png")
);

buildIcns(
  {
    "icon_16x16.png": s16,
    "icon_16x16@2x.png": s32,
    "icon_32x32.png": s32,
    "icon_32x32@2x.png": s64,
    "icon_128x128.png": s128,
    "icon_128x128@2x.png": m256,
    "icon_256x256.png": m256,
    "icon_256x256@2x.png": m512,
    "icon_512x512.png": m512,
    "icon_512x512@2x.png": m1024,
  },
  join(resourcesDir, "icon.icns")
);

for (const line of ["icon.png", "tray-icon.png", "icon.icns"]) {
  console.log(`Generated ${join(resourcesDir, line)}`);
}
