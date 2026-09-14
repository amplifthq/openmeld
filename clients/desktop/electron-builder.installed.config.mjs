import { readFileSync } from "node:fs";
import { readInstalledDesktopTarget } from "../../scripts/desktop/installed-target.ts";

const target = readInstalledDesktopTarget(process.env);
if (!target) {
  throw new Error("Select a fixed installed Desktop build target.");
}
const { build } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
);

// Reviewable local artifact only. Signing/publication is a separate release gate.
export default {
  ...build,
  appId: target.appId,
  productName: target.dataDirectory,
  directories: { output: "dist/installed" },
  files: build.files
    .filter((file) => file !== "out/**/*")
    .concat(["out/main/**/*", "out/preload/**/*"]),
  extraResources: [{ from: "dist/installed-renderer", to: "desktop-renderer" }],
  protocols: [
    { name: "OpenMeld Desktop sign-in", schemes: [target.authScheme] },
  ],
  mac: { ...build.mac, identity: null, notarize: false },
  publish: null,
};
