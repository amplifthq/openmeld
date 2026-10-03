import { readFileSync } from "node:fs";
import path from "node:path";

function readBackendManifest(root) {
  return JSON.parse(
    readFileSync(path.join(root, "release/database-backend.json"), "utf8")
  );
}

/** No flag bypasses the separately reviewed data cutover and product binding contract. */
export function assertProductDatabaseReleaseSupported(root = process.cwd()) {
  const manifest = readBackendManifest(root);
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

// This is preparation output inside the existing release owner, never an
// executor or an admission receipt. It reads tracked inventory, not cloud state.
export async function readPostgresqlCutoverPreparation(root = process.cwd()) {
  const manifest = readBackendManifest(root);
  if (
    manifest.backend !== "postgresql" ||
    manifest.productCutover !== "unavailable"
  ) {
    throw new Error(
      "Cutover preparation requires the blocked PostgreSQL candidate manifest."
    );
  }
  const resources = JSON.parse(
    readFileSync(path.join(root, "tooling/postgresql/resources.json"), "utf8")
  );
  const target = resources.environments.production;
  if (
    resources.engine !== "postgresql" ||
    target.majorVersion !== "18" ||
    !(
      target.databaseId &&
      target.branchId &&
      target.host &&
      target.hyperdriveId
    )
  ) {
    throw new Error("The registered PostgreSQL 18 target is incomplete.");
  }
  const { readMigrations } = await import(
    "../../tooling/postgresql/database.mjs"
  );
  const migrations = await readMigrations(
    path.join(root, "packages/db/postgresql/migrations")
  );
  return {
    mode: "preparation_only",
    promotionAllowed: false,
    reasonCode: "postgresql_cutover_unavailable",
    inventorySource: "tracked configuration; live provider state not inspected",
    target: {
      backend: resources.engine,
      majorVersion: target.majorVersion,
      organization: resources.organization,
      database: target.database,
      databaseId: target.databaseId,
      branchId: target.branchId,
      host: target.host,
      hyperdriveId: target.hyperdriveId,
    },
    nativeMigrations: migrations.map(({ name, checksum }) => ({
      name,
      checksum,
    })),
    requiredBeforePromotion: [
      "Reviewed immutable source, authorized maintenance owner and existing release scope leases.",
      "Live target identity, capacity, direct migration role, runtime grants and cache-disabled Hyperdrive verified.",
      "Every ingress producer, scheduler, queue, workflow, socket, DO alarm, outbox and operator writer inventoried and frozen or safely converged.",
      "Real active workstation execution observed in RuntimeCoordinator; new admission denied while accepted work reaches its authoritative final outcome and visible Space publication.",
      "Globally stable D1 capture, complete native import and full-field/identity reconciliation with no dual relational writer.",
      "Retained DO/R2 IDs, messages, file bodies, permissions and effects reconciled with the target database.",
      "Mixed-component and installed CLI/Service compatibility resolved; maintenance does not waive receiver-first dependencies.",
      "Cloud product login, retained sessions, permissions, real Wake and restart/recovery acceptance proven.",
      "Interrupted-maintenance recovery rehearsed on both sides of the first new PostgreSQL write.",
    ],
    maintenanceSequence: [
      "Before admission closes: review source/target identity, restore evidence, capacity and complete writer inventory.",
      "Close new admission at its owning entries; retain accepted work and let its authoritative owners converge, or use explicit normal stop.",
      "After convergence: freeze remaining writers, establish a consistent source and capture its complete manifest.",
      "Import into the empty native target, reconcile every field and generator, then verify retained DO/R2 references while writes stay closed.",
      "Only through a separately reviewed executor: promote the coordinated bindings/components under the existing release leases and validate the product.",
      "Reopen admission only after acceptance and recovery gates pass; retain source and migration evidence for the reviewed recovery period.",
    ],
    recovery: {
      beforeFirstPostgresqlWrite:
        "Keep admission closed. Restore the coherent source/bindings to the unchanged frozen D1 authority, reconcile retained DO/R2 effects and validate before reopening.",
      afterFirstPostgresqlWrite:
        "Freeze again and preserve/reconcile new PostgreSQL writes plus DO/R2 effects, or forward-fix. Never point writers back to the stale D1 snapshot.",
    },
    evidenceStatus: "not_evaluated",
    executor: "unavailable",
  };
}
