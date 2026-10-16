import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyDesktopArchive } from "./verify-archive.mjs";

const requireDesktop = createRequire(
  new URL("../../clients/desktop/package.json", import.meta.url)
);
const requireBuilder = createRequire(
  requireDesktop.resolve("electron-builder/package.json")
);
const asar = requireBuilder("@electron/asar");
const CORRUPT_MAIN = /archive integrity failed for main.js/u;

test("accepts a real archive and rejects changed content despite an intact file index", async () => {
  const root = mkdtempSync(join(tmpdir(), "desktop-archive-"));
  try {
    const source = join(root, "source");
    mkdirSync(source);
    writeFileSync(
      join(source, "package.json"),
      JSON.stringify({ main: "main.js" })
    );
    writeFileSync(join(source, "main.js"), "console.log('archive-smoke');");
    const archive = join(root, "app.asar");
    await asar.createPackage(source, archive);
    verifyDesktopArchive(archive);
    const bytes = readFileSync(archive);
    const offset = bytes.indexOf(Buffer.from("console.log('archive-smoke');"));
    assert.ok(offset > 0);
    bytes[offset] = 0;
    writeFileSync(archive, bytes);
    assert.throws(() => verifyDesktopArchive(archive), CORRUPT_MAIN);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
