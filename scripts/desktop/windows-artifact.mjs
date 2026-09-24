import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { assertWindowsUpdaterConfiguration } from "../../clients/desktop/src/main/update/windows-updater-configuration.ts";
import {
  desktopProductionSourceSchema,
  desktopWebBuildSchema,
} from "../../packages/schemas/dist/desktop-client.js";
import { desktopWindowsBuildSchema } from "../../packages/schemas/dist/desktop-release.js";
import { verifyWindowsArtifactSignature } from "../../runtime/local-service/src/windows-artifact-signature.ts";
import { readInstalledDesktopTarget } from "./installed-target.ts";

const PE_MACHINE = { "windows-x64": 0x86_64, "windows-arm64": 0xaa_64 };
const MAX_METADATA_BYTES = 65_536;
const fixedTarget = readInstalledDesktopTarget({
  OPENMELD_DESKTOP_TARGET: "production",
});

export function assertWindowsPeArchitecture(bytes, platform) {
  const data = Buffer.from(bytes);
  if (
    !(platform in PE_MACHINE) ||
    data.length < 64 ||
    data.readUInt16LE(0) !== 0x5a_4d
  ) {
    throw new Error("Windows Desktop executable has no valid DOS/PE header.");
  }
  const offset = data.readUInt32LE(0x3c);
  if (
    offset < 64 ||
    offset > data.length - 24 ||
    data.readUInt32LE(offset) !== 0x45_50 ||
    data.readUInt16LE(offset + 4) !== PE_MACHINE[platform]
  ) {
    throw new Error(
      "Windows Desktop executable architecture does not match its candidate platform."
    );
  }
}

export function assertWindowsCandidateContents(input) {
  const windows = desktopWindowsBuildSchema.parse(input.windows);
  const source = desktopProductionSourceSchema.parse(input.source);
  const marker = desktopWebBuildSchema.parse(input.marker);
  if (
    source.releaseSha !== input.approvedSha ||
    source.webBuild !== marker.webBuild ||
    JSON.stringify(source.target) !== JSON.stringify(fixedTarget) ||
    JSON.stringify(marker.installedTarget) !== JSON.stringify(fixedTarget) ||
    JSON.stringify(source.windows) !== JSON.stringify(windows) ||
    input.packageName !== "@openmeld/desktop" ||
    input.packageVersion !== input.version
  ) {
    throw new Error(
      "The signed Windows payload's version, source, target, renderer or publisher does not match the approved candidate."
    );
  }
  assertWindowsUpdaterConfiguration({
    configuration: input.updateConfig,
    windows,
    arch: windows.platform.slice("windows-".length),
  });
  return source.releaseSha;
}

function resolve7Zip(env) {
  const candidates = env.OPENMELD_DESKTOP_7ZIP
    ? [env.OPENMELD_DESKTOP_7ZIP]
    : [
        ...(env.ProgramFiles
          ? [join(env.ProgramFiles, "7-Zip", "7z.exe")]
          : []),
        ...(env["ProgramFiles(x86)"]
          ? [join(env["ProgramFiles(x86)"], "7-Zip", "7z.exe")]
          : []),
      ];
  for (const path of candidates) {
    if (isAbsolute(path) && existsSync(path) && lstatSync(path).isFile()) {
      return path;
    }
  }
  throw new Error(
    "Signed Windows artifact inspection requires full 7-Zip (7z.exe with NSIS support). Install it on the release workstation or set OPENMELD_DESKTOP_7ZIP to its absolute path."
  );
}

function ownedFile(root, name) {
  const path = join(root, name);
  const relation = relative(realpathSync(root), realpathSync(path));
  if (
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation) ||
    !lstatSync(path).isFile()
  ) {
    throw new Error(
      "Windows candidate contains an unexpected file outside its extracted payload."
    );
  }
  return path;
}
function readMetadata(path) {
  if (lstatSync(path).size > MAX_METADATA_BYTES) {
    throw new Error("Windows candidate metadata exceeds the supported size.");
  }
  return readFileSync(path, "utf8");
}
function executableHeader(path) {
  const file = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(MAX_METADATA_BYTES);
    return buffer.subarray(0, readSync(file, buffer, 0, buffer.length, 0));
  } finally {
    closeSync(file);
  }
}
async function fingerprint(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

/** Inspect authenticated NSIS contents without running an installer or touching user/OS state. */
export async function inspectWindowsDesktopCandidate({
  repoRoot,
  artifactPath,
  version,
  approvedSha,
  windows: rawWindows,
}) {
  if (process.platform !== "win32") {
    throw new Error("Inspect a signed Windows candidate on native Windows.");
  }
  const windows = desktopWindowsBuildSchema.parse(rawWindows);
  const before = await fingerprint(artifactPath);
  await verifyWindowsArtifactSignature(artifactPath, windows.publisherName);
  const sevenZip = resolve7Zip(process.env);
  const temporary = mkdtempSync(join(tmpdir(), "openmeld-windows-candidate-"));
  const run = (args) =>
    execFileSync(sevenZip, args, {
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  try {
    const outer = join(temporary, "installer");
    const app = join(temporary, "app");
    mkdirSync(outer);
    mkdirSync(app);
    // Pinned electron-builder's standard NSIS template embeds one per-arch
    // app archive. Read that signed payload, not an unrelated unpacked directory.
    const archive =
      windows.platform === "windows-x64" ? "app-64.7z" : "app-arm64.7z";
    run([
      "x",
      artifactPath,
      `-o${outer}`,
      "-y",
      "-bd",
      `$PLUGINSDIR\\${archive}`,
    ]);
    const payload = ownedFile(outer, join("$PLUGINSDIR", archive));
    run(["x", payload, `-o${app}`, "-y", "-bd"]);
    const executable = ownedFile(app, "OpenMeld.exe");
    assertWindowsPeArchitecture(executableHeader(executable), windows.platform);
    await verifyWindowsArtifactSignature(executable, windows.publisherName);
    const source = JSON.parse(
      readMetadata(ownedFile(app, "resources/desktop-production-source.json"))
    );
    const marker = JSON.parse(
      readMetadata(
        ownedFile(app, "resources/desktop-renderer/desktop-build.json")
      )
    );
    const require = createRequire(
      join(repoRoot, "clients/desktop/package.json")
    );
    const builder = createRequire(
      require.resolve("electron-builder/package.json")
    );
    const packager = createRequire(
      builder.resolve("app-builder-lib/package.json")
    );
    const asar = packager("@electron/asar");
    const packageBytes = asar.extractFile(
      ownedFile(app, "resources/app.asar"),
      "package.json"
    );
    if (packageBytes.length > MAX_METADATA_BYTES) {
      throw new Error("Windows application package metadata is too large.");
    }
    const pkg = JSON.parse(packageBytes.toString("utf8"));
    const { parse } = require("yaml");
    const updateConfig = parse(
      readMetadata(ownedFile(app, "resources/app-update.yml")),
      { maxAliasCount: 0 }
    );
    const releaseSha = assertWindowsCandidateContents({
      source,
      marker,
      windows,
      approvedSha,
      version,
      packageName: pkg.name,
      packageVersion: pkg.version,
      updateConfig,
    });
    if ((await fingerprint(artifactPath)) !== before) {
      throw new Error("Windows installer changed during verification.");
    }
    return releaseSha;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

/** Inspect the shipped unsigned internal installer without installing it. */
export async function inspectWindowsInternalPreview({
  repoRoot,
  artifactPath,
  version,
  sourceSha,
  expectedWebBuild,
}) {
  if (process.platform !== "win32") {
    throw new Error("Inspect the internal Desktop preview on native Windows.");
  }
  const before = await fingerprint(artifactPath);
  const sevenZip = resolve7Zip(process.env);
  const temporary = mkdtempSync(join(tmpdir(), "openmeld-windows-preview-"));
  const run = (args) =>
    execFileSync(sevenZip, args, {
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  try {
    const outer = join(temporary, "installer");
    const app = join(temporary, "app");
    mkdirSync(outer);
    mkdirSync(app);
    run([
      "x",
      artifactPath,
      `-o${outer}`,
      "-y",
      "-bd",
      "$PLUGINSDIR\\app-64.7z",
    ]);
    run([
      "x",
      ownedFile(outer, join("$PLUGINSDIR", "app-64.7z")),
      `-o${app}`,
      "-y",
      "-bd",
    ]);
    assertWindowsPeArchitecture(
      executableHeader(ownedFile(app, "OpenMeld.exe")),
      "windows-x64"
    );
    const source = desktopProductionSourceSchema.parse(
      JSON.parse(
        readMetadata(
          ownedFile(app, "resources/desktop-internal-preview-source.json")
        )
      )
    );
    const marker = desktopWebBuildSchema.parse(
      JSON.parse(
        readMetadata(
          ownedFile(app, "resources/desktop-renderer/desktop-build.json")
        )
      )
    );
    if (
      source.releaseSha !== sourceSha ||
      source.webBuild !== expectedWebBuild ||
      marker.webBuild !== expectedWebBuild ||
      JSON.stringify(source.target) !== JSON.stringify(fixedTarget) ||
      JSON.stringify(marker.installedTarget) !== JSON.stringify(fixedTarget) ||
      source.windows ||
      existsSync(join(app, "resources/app-update.yml"))
    ) {
      throw new Error(
        "The internal Windows installer has unexpected source, target, renderer or update settings."
      );
    }
    const require = createRequire(
      join(repoRoot, "clients/desktop/package.json")
    );
    const builder = createRequire(
      require.resolve("electron-builder/package.json")
    );
    const packager = createRequire(
      builder.resolve("app-builder-lib/package.json")
    );
    const asar = packager("@electron/asar");
    const pkg = JSON.parse(
      asar
        .extractFile(ownedFile(app, "resources/app.asar"), "package.json")
        .toString("utf8")
    );
    if (pkg.name !== "@openmeld/desktop" || pkg.version !== version) {
      throw new Error(
        "The internal Windows installer contains the wrong Desktop package."
      );
    }
    if ((await fingerprint(artifactPath)) !== before) {
      throw new Error(
        "The internal Windows installer changed during inspection."
      );
    }
    return source.releaseSha;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
