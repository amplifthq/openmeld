import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// Use the pinned upstream compiler and SEA bootstrap. Only the Linux image is
// built here; the upstream release script also builds an unrelated macOS binary.
const root = process.cwd();
const requireRpc = createRequire(resolve(root, "packages/rpc/package.json"));
const capnwebRoot = resolve(requireRpc.resolve("capnweb"), "../..");
const capnwebPackage = JSON.parse(
  await readFile(resolve(capnwebRoot, "package.json"), "utf8")
);
if (capnwebPackage.version !== "0.12.0") {
  throw new Error("Unexpected native capnweb version");
}
execFileSync("patch", ["-p1", "-i", resolve(root, "openmeld-capnweb.patch")], {
  cwd: capnwebRoot,
});
if (
  process.platform !== "linux" ||
  process.arch !== "x64" ||
  process.version !== "v22.22.3"
) {
  throw new Error(
    "computerd requires the pinned Node 22.22.3 Linux x64 builder"
  );
}
const { bundleComputerd } = await import(
  resolve(root, "packages/computerd/scripts/sea/bundle.mjs")
);
const work = resolve(root, "artifacts/computerd");
await mkdir(work, { recursive: true });
const bundle = resolve(work, "linux-x64.bundle.mjs");
const blob = resolve(work, "linux-x64.blob");
const config = resolve(work, "linux-x64.sea-config.json");
const binary = resolve(work, "computerd");
await bundleComputerd({
  outfile: bundle,
  target: { libfuseName: "libfuse.so.2", envVar: "LD_LIBRARY_PATH" },
});
await writeFile(
  config,
  JSON.stringify({
    main: resolve(root, "packages/computerd/scripts/sea/bootstrap.cjs"),
    output: blob,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets: {
      "bundle.mjs": bundle,
      "fuse-native.node": resolve(
        root,
        "node_modules/fuse-native/prebuilds/linux-x64/node.napi.node"
      ),
      "libfuse.so.2": resolve(
        root,
        "node_modules/fuse-shared-library-linux/libfuse/lib/libfuse.so"
      ),
    },
  })
);
execFileSync(process.execPath, ["--experimental-sea-config", config]);
await copyFile(process.execPath, binary);
await chmod(binary, 0o755);
execFileSync(process.execPath, [
  resolve(root, "node_modules/postject/dist/cli.js"),
  binary,
  "NODE_SEA_BLOB",
  blob,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  "--overwrite",
]);
const hash = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
await writeFile(
  resolve(work, "source.json"),
  `${JSON.stringify(
    {
      upstreamCommit: "ec39cb693a5be73a735d375e228b4e2adb754abb",
      sourceArchiveSha256:
        "f01ac86d7716bca575517f29786ace8c8e5be6d3908914ca7894656b7b81c74d",
      dependencyLockSha256: await hash(resolve(root, "package-lock.json")),
      sourcePatchSha256: await hash(resolve(root, "openmeld-source.patch")),
      transportPatchSha256: await hash(resolve(root, "openmeld-capnweb.patch")),
      binarySha256: await hash(binary),
      nodeVersion: process.version,
    },
    null,
    2
  )}\n`
);
