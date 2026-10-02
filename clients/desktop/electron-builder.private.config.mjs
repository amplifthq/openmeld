import { readFileSync } from "node:fs";
import { desktopAuthIdentity } from "../../packages/schemas/src/desktop-auth-identity.ts";
import { withDesktopAppName } from "../../scripts/desktop/app-name.ts";

const { build: baseBuild } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
);

// Private existing-Service pilot; no preview metadata or publishing target.
const identity = desktopAuthIdentity(false, "private", process.env.WEB_APP_URL);
const build = withDesktopAppName(baseBuild, identity.authScheme);
export default {
  ...build,
  directories: { output: "dist/private" },
  files: build.files
    .filter((file) => file !== "out/**/*")
    .concat(["out/main/**/*", "out/preload/**/*"]),
  extraResources: [{ from: "dist/private-renderer", to: "desktop-renderer" }],
  protocols: [
    {
      name: "OpenMeld Desktop development sign-in",
      schemes: [identity.authScheme],
    },
  ],
  dmg: {
    ...build.dmg,
    artifactName: build.dmg.artifactName.replace(
      "Desktop-",
      "Desktop-Private-"
    ),
  },
  publish: null,
};
