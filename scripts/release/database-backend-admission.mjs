import { readFileSync } from "node:fs";
import path from "node:path";

/** No flag bypasses the separately reviewed data cutover and product binding contract. */
export function assertProductDatabaseReleaseSupported(root = process.cwd()) {
  const manifest = JSON.parse(
    readFileSync(path.join(root, "release/database-backend.json"), "utf8")
  );
  if (
    manifest.backend === "postgresql" &&
    manifest.productCutover === "unavailable"
  ) {
    throw new Error(
      "PostgreSQL product cutover is unavailable. Production and shared staging remain on the deployed D1 revision; use the isolated PostgreSQL development stack."
    );
  }
  throw new Error(
    "Product database release support must be defined by the reviewed cutover control plane."
  );
}
