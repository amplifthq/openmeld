-- Reviewed isolated foundation only. No DROP, DELETE, ledger adoption or data reset.
-- The launcher must separately verify Amplift database jacdfxhph47k / branch aol2e3kwz867.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(640021017);
DO $preserve$
BEGIN
  IF current_user <> 'pscale_api_m7rr7fm14at8' OR current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Unexpected foundation role or database';
  END IF;
  IF NOT has_database_privilege(current_user, current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'Existing migration role lacks database CREATE';
  END IF;
  IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('openmeld', 'openmeld_meta') AND pg_get_userbyid(nspowner) = current_user) <> 2 THEN
    RAISE EXCEPTION 'Unexpected foundation schema ownership';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='openmeld')
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='openmeld')
     OR EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='openmeld') THEN
    RAISE EXCEPTION 'Foundation application schema is not empty';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('drizzle','openmeld_migration','openmeld_foundation_20261002','openmeld_foundation_meta_20261002')) THEN
    RAISE EXCEPTION 'Current journal, import metadata or archive namespace already exists';
  END IF;
  IF (SELECT count(*) FROM openmeld_meta.migrations) <> 1 OR
     NOT EXISTS (SELECT 1 FROM openmeld_meta.migrations WHERE name='0001_foundation.sql' AND checksum='21d5d3acd697e012a3b2aadf4fa15833827a53d043aa3f3d7400a10a8eb1bc9c' AND applied_at='2026-10-02T17:26:58.727893Z'::timestamptz) THEN
    RAISE EXCEPTION 'Historical foundation ledger differs from reviewed evidence';
  END IF;
END
$preserve$;
ALTER SCHEMA openmeld RENAME TO openmeld_foundation_20261002;
ALTER SCHEMA openmeld_meta RENAME TO openmeld_foundation_meta_20261002;
COMMIT;
