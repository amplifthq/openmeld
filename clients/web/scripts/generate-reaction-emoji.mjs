import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Keep the picker and server allowlist on the same pinned Unicode dataset.
const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(web, "package.json"));
const dataPath = require.resolve("emojibase-data/en/data.json");
const dataset = resolve(dirname(dataPath), "..");
const { version } = JSON.parse(
	await readFile(resolve(dataset, "package.json"), "utf8")
);
const assets = resolve(web, "public/emoji", version, "en");
await mkdir(assets, { recursive: true });
for (const file of ["data.json", "messages.json"]) {
	await copyFile(resolve(dataset, "en", file), resolve(assets, file));
}
await copyFile(resolve(dataset, "LICENSE"), resolve(assets, "../LICENSE"));
const entries = {};
function add(entry) {
	const value = [entry.emoji, entry.label];
	entries[entry.emoji] = value;
	if (entry.text) {
		entries[entry.text] = value;
	}
	// hexcode is Emojibase's unqualified alias, not generic Unicode stripping.
	entries[
		String.fromCodePoint(
			...entry.hexcode.split("-").map((hex) => Number.parseInt(hex, 16))
		)
	] = value;
	for (const skin of entry.skins ?? []) {
		add(skin);
	}
}
for (const entry of JSON.parse(await readFile(dataPath, "utf8"))) {
	add(entry);
}
await writeFile(
	resolve(web, "../../services/core/src/space/domain/reaction-emoji.json"),
	`${JSON.stringify(entries)}\n`
);
console.log(
	`Generated reaction emoji assets and allowlist from Emojibase ${version}.`
);
