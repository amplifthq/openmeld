import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Resolve from the packaged main entry's location, as Electron will do.
const requireMain = createRequire(
  new URL("../out/main/index.js", import.meta.url)
);
await import(
  pathToFileURL(requireMain.resolve("@openmeld/start/node-runtime")).href
);
