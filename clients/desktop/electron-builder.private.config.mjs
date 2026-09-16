import { readFileSync } from "node:fs";
import { DESKTOP_AUTH_SCHEME } from "@openmeld/schemas";

const { build } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
);

// Private existing-Service pilot; no preview metadata or publishing target.
export default {
  ...build,
  appId: "sh.openmeld.desktop.dev",
  productName: "OpenMeld Desktop Private",
  directories: { output: "dist/private" },
  files: build.files
    .filter((file) => file !== "out/**/*")
    .concat(["out/main/**/*", "out/preload/**/*"]),
  extraResources: [{ from: "dist/private-renderer", to: "desktop-renderer" }],
  protocols: [
    {
      name: "OpenMeld Desktop development sign-in",
      schemes: [DESKTOP_AUTH_SCHEME],
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
