import { sql } from "drizzle-orm";
import { pgSchema } from "drizzle-orm/pg-core";

export const applicationSchema = pgSchema("openmeld");
export const applicationTable = applicationSchema.table;

// Persist epoch milliseconds with SQLite's truncation semantics, not PostgreSQL's
// numeric-to-bigint rounding. Every timestamp default uses this shared expression.
export const currentTimestampMilliseconds = sql`floor(extract(epoch from clock_timestamp()) * 1000)::bigint`;
