declare module "cloudflare:test" {
  type ProvidedEnv = {
    OPENMELD_DB: D1Database;
    OPENMELD_ORGANIZATION_SKILLS: R2Bucket;
    OPENMELD_SPACES: unknown;
    TEST_MIGRATIONS: D1Migration[];
    // Physical DB split routing gate (wrangler.split-gate.jsonc) binds these as
    // separate per-domain databases; optional so the main integration pool,
    // which binds only OPENMELD_DB, still typechecks.
    OPENMELD_LOCAL_STATE_DB?: D1Database;
    OPENMELD_WAKE_EVIDENCE_DB?: D1Database;
    OPENMELD_PROJECTIONS_DB?: D1Database;
    OPENMELD_RUNTIME_TRANSPORT?: unknown;
    OPENMELD_PREPARE_SESSION_HUB?: unknown;
  };
}

declare module "*.sql?raw" {
  const content: string;
  export default content;
}
