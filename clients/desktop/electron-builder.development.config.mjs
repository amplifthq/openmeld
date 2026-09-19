import { readFileSync } from "node:fs";
import { desktopAuthIdentity } from "../../packages/schemas/src/desktop-auth-identity.ts";
import { readDesktopDevelopmentContext } from "../../scripts/desktop/development-context.ts";

const { build } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
);
const context = readDesktopDevelopmentContext(process.env);
if (!context) {
  throw new Error("Use pnpm desktop:prepare to build a worktree app.");
}
const identity = desktopAuthIdentity(false, undefined, context.webOrigin);
const productName = `OpenMeld Dev ${context.laneId}`;

// Reuse normal packaging/signature policy, but never create an installer or publish.
export default {
  ...build,
  appId: identity.authScheme,
  productName,
  directories: { output: "dist/development" },
  files: build.files
    .filter((file) => file !== "out/**/*")
    .concat(["out/main/**/*", "out/preload/**/*"]),
  extraResources: [{ from: "dist/private-renderer", to: "desktop-renderer" }],
  protocols: [
    { name: "OpenMeld worktree sign-in", schemes: [identity.authScheme] },
  ],
  mac: {
    ...build.mac,
    extendInfo: { ...build.mac.extendInfo, CFBundleDisplayName: productName },
  },
  publish: null,
};
