import { copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildIco,
	renderMasterPng,
	renderSimplePng,
} from "./logo-pipeline.mjs";

// Regenerates the entire web favicon set from the single logo source of truth.
// Small sizes render the legible SIMPLE variant; large sizes downscale the
// approved glow master. SVG favicons are intentionally retired (the glow cannot
// be reproduced as a vector) — every browser size is shipped as a native PNG.

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "..", "public");
const tmp = tmpdir();

// Tiny sizes: solid O, slightly fuller as the canvas shrinks so it stays legible.
const ico16 = renderSimplePng(16, join(tmp, "openmeld-fav-16.png"), {
	content: 0.86,
});
const ico32 = renderSimplePng(32, join(tmp, "openmeld-fav-32.png"), {
	content: 0.82,
});
const ico48 = renderSimplePng(48, join(tmp, "openmeld-fav-48.png"), {
	content: 0.8,
});

copyFileSync(ico16, join(publicDir, "favicon-16x16.png"));
copyFileSync(ico32, join(publicDir, "favicon-32x32.png"));
buildIco(
	[
		{ size: 16, path: ico16 },
		{ size: 32, path: ico32 },
		{ size: 48, path: ico48 },
	],
	join(publicDir, "favicon.ico")
);

// Large sizes: faithful glow master.
renderMasterPng(180, join(publicDir, "apple-touch-icon.png"));
renderMasterPng(192, join(publicDir, "icon-192.png"));
renderMasterPng(512, join(publicDir, "icon-512.png"));

for (const line of [
	"favicon-16x16.png",
	"favicon-32x32.png",
	"favicon.ico",
	"apple-touch-icon.png",
	"icon-192.png",
	"icon-512.png",
]) {
	console.log(`Generated ${join(publicDir, line)}`);
}
