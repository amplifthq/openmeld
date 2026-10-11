import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OPENMELD_LETTER_O_LOGO_LINES,
  OPENMELD_LOGO_LINES,
} from "../src/lib/openmeld-logo-lines.ts";
import { renderBrandAssets } from "./brand-renderer.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const EXPORT_ELEMENT = /<div id="exports">(.*?)<\/div>/s;
export const repositoryRoot = resolve(here, "../../..");
export const brandDirectory = resolve(here, "../public/brand");

export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  const executable = candidates.find(
    (candidate) => candidate && existsSync(candidate)
  );
  if (!executable) {
    throw new Error("Install Chromium or set CHROME_PATH.");
  }
  return executable;
}

export function copyBrandAsset(name, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(brandDirectory, name), destination);
  return destination;
}

export function resizeBrandAsset(name, size, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  execFileSync(
    "sips",
    [
      "-z",
      String(size),
      String(size),
      join(brandDirectory, name),
      "--out",
      destination,
    ],
    { stdio: "pipe" }
  );
  return destination;
}

export function generateBrandAssets() {
  // Generation uses macOS Menlo and iconutil.
  // Consumers use checked-in PNGs; they do not need a system font or Chromium.
  if (process.platform !== "darwin") {
    throw new Error("Generate official brand assets on macOS.");
  }
  const config = {
    letter: OPENMELD_LETTER_O_LOGO_LINES,
    word: OPENMELD_LOGO_LINES,
  };
  const temporaryRoot = join(repositoryRoot, "dev-tmp");
  mkdirSync(temporaryRoot, { recursive: true });
  const temporary = mkdtempSync(join(temporaryRoot, "brand-export-"));
  try {
    const page = join(temporary, "render.html");
    writeFileSync(
      page,
      `<!doctype html><meta charset="utf-8"><div id="exports"></div><script>(${renderBrandAssets.toString()})(${JSON.stringify(config)})</script>`
    );
    const dom = execFileSync(
      findChrome(),
      [
        "--headless=new",
        "--disable-gpu",
        "--dump-dom",
        "--virtual-time-budget=2000",
        `file://${page}`,
      ],
      {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    const match = dom.match(EXPORT_ELEMENT);
    if (!match?.[1]) {
      throw new Error("Browser did not complete the brand export.");
    }
    const { assets } = JSON.parse(match[1]);
    mkdirSync(brandDirectory, { recursive: true });
    for (const [name, dataUrl] of Object.entries(assets)) {
      const data = Buffer.from(dataUrl.split(",")[1], "base64");
      writeFileSync(join(brandDirectory, name), data);
    }
    // Native icon layers must preserve the approved master artwork's placement.
    // Do not redraw a second tile and mark at each Dock size.
    for (const size of [16, 32, 64, 128]) {
      resizeBrandAsset(
        "openmeld-desktop-1024.png",
        size,
        join(brandDirectory, `openmeld-desktop-${size}.png`)
      );
    }
    console.log(
      `Generated ${Object.keys(assets).length} official brand assets.`
    );
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  generateBrandAssets();
}
// Pack PNGs into a multi-size .ico (Vista+ PNG-in-ICO; no deps).
export function buildIco(entries, outPath) {
  const pngs = entries.map((entry) => ({
    size: entry.size,
    data: readFileSync(entry.path),
  }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const directory = [];
  let offset = 6 + pngs.length * 16;
  for (const png of pngs) {
    const entry = Buffer.alloc(16);
    const dim = png.size >= 256 ? 0 : png.size;
    entry.writeUInt8(dim, 0);
    entry.writeUInt8(dim, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.data.length;
    directory.push(entry);
  }
  writeFileSync(
    outPath,
    Buffer.concat([header, ...directory, ...pngs.map((p) => p.data)])
  );
  return outPath;
}

// Build a macOS .icns from an iconset map { "icon_16x16.png": pngPath, ... }.
export function buildIcns(iconset, outPath) {
  const iconsetDir = join(
    repositoryRoot,
    "dev-tmp",
    `openmeld-${process.pid}.iconset`
  );
  rmSync(iconsetDir, { force: true, recursive: true });
  mkdirSync(iconsetDir, { recursive: true });
  for (const [filename, path] of Object.entries(iconset)) {
    copyFileSync(path, join(iconsetDir, filename));
  }
  rmSync(outPath, { force: true });
  execFileSync("iconutil", ["-c", "icns", iconsetDir, "-o", outPath], {
    stdio: "pipe",
  });
  rmSync(iconsetDir, { force: true, recursive: true });
  return outPath;
}
