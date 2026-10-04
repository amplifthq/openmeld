-- PostgreSQL history starts here; D1 migration history remains immutable.
-- This creates no business tables and imports no D1 data.
CREATE SCHEMA openmeld;
REVOKE ALL ON SCHEMA openmeld FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
