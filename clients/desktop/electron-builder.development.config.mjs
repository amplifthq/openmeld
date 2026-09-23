import { readFileSync } from "node:fs";
import { desktopAuthIdentity } from "../../packages/schemas/src/desktop-auth-identity.ts";
import { withDesktopAppName } from "../../scripts/desktop/app-name.ts";
import { readDesktopDevelopmentContext } from "../../scripts/desktop/development-context.ts";

const { build: baseBuild } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
);
const context = readDesktopDevelopmentContext(process.env);
if (!context) {
  throw new Error("Use pnpm desktop:prepare to build a worktree app.");
}
const identity = desktopAuthIdentity(false, undefined, context.webOrigin);
const build = withDesktopAppName(baseBuild, identity.authScheme);

// Reuse normal packaging/signature policy, but never create an installer or publish.
export default {
  ...build,
  directories: { output: "dist/development" },
  files: build.files
    .filter((file) => file !== "out/**/*")
    .concat(["out/main/**/*", "out/preload/**/*"]),
  extraResources: [{ from: "dist/private-renderer", to: "desktop-renderer" }],
  protocols: [
    { name: "OpenMeld worktree sign-in", schemes: [identity.authScheme] },
  ],
  publish: null,
};
