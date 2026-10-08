import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	brandDirectory,
	buildIco,
	copyBrandAsset,
	resizeBrandAsset,
} from "../../../packages/ui/scripts/brand-assets.mjs";

const publicDirectory = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../packages/ui/public"
);
const entries = [16, 32, 48].map((size) => ({
	size,
	path: join(brandDirectory, `openmeld-favicon-${size}.png`),
}));
for (const size of [16, 32]) {
	copyBrandAsset(
		`openmeld-favicon-${size}.png`,
		join(publicDirectory, `favicon-${size}x${size}.png`)
	);
}
buildIco(entries, join(publicDirectory, "favicon.ico"));
for (const [size, name] of [
	[180, "apple-touch-icon.png"],
	[192, "icon-192.png"],
	[512, "icon-512.png"],
]) {
	resizeBrandAsset(
		"openmeld-letter-o-dark-1024.png",
		size,
		join(publicDirectory, name)
	);
}
console.log("Generated Web icons from shared brand assets.");
