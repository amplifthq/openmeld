import { fileURLToPath } from "node:url";
import { buildRenderer } from "../release/renderer-build.mjs";

await buildRenderer(
  fileURLToPath(new URL("../../", import.meta.url)),
  process.env,
  {
    buildScript: "build",
    defaultHeapMiB: 5120,
  }
);
