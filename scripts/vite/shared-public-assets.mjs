import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sharedPublic = fileURLToPath(
  new URL("../../packages/ui/public/", import.meta.url)
);

// Vite serves this generated public directory in dev and copies it into each
// independent artifact at build time. The shared package owns the source bytes.
export function prepareSharedPublicAssets(clientDirectory) {
  const destination = path.join(clientDirectory, "public");
  mkdirSync(destination, { recursive: true });
  cpSync(sharedPublic, destination, { recursive: true });
}
