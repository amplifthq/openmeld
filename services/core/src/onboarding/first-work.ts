import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  type FirstWorkRecord,
  firstWorkRecordSchema,
  type WalkthroughStep,
} from "@openmeld/schemas";

type Scope = { organizationId: string; userId: string };
export async function hasStartedTutorial(
  db: PostgresDatabase,
  userId: string
): Promise<boolean> {
  const result = await db.query<{ started: boolean }>({
    text: "SELECT EXISTS (SELECT 1 FROM openmeld.first_work_experiences WHERE user_id = $1) AS started",
    values: [userId],
  });
  return result.rows[0]?.started === true;
}
export async function readFirstWork(
  db: PostgresDatabase,
  scope: Scope
): Promise<FirstWorkRecord | null> {
  const result = await db.query({
    text: `SELECT organization_id AS "organizationId", profile_id AS "profileId", space_id AS "spaceId", run_id AS "runId", revision, iteration, step, paused = 1 AS paused FROM openmeld.first_work_experiences WHERE organization_id = $1 AND user_id = $2`,
    values: [scope.organizationId, scope.userId],
  });
  return result.rows[0] ? firstWorkRecordSchema.parse(result.rows[0]) : null;
}
// Reserve presentation identity only. The user creates the actual Space.
// A stale tab cannot overwrite a newer run.
export async function reserveFirstWork(
  db: PostgresDatabase,
  input: Scope & {
    profileId: string;
    spaceId: string;
    runId: string;
    previousRunId: string | null;
  }
): Promise<FirstWorkRecord | null> {
  await db.query({
    text: `INSERT INTO openmeld.first_work_experiences (organization_id, user_id, profile_id, space_id, run_id, created_at_ms)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (organization_id, user_id) DO UPDATE SET profile_id = EXCLUDED.profile_id, space_id = EXCLUDED.space_id, run_id = EXCLUDED.run_id, created_at_ms = EXCLUDED.created_at_ms, revision = 0, iteration = first_work_experiences.iteration + 1, step = 'create-space', paused = 0
      WHERE first_work_experiences.run_id = $7 AND first_work_experiences.run_id <> EXCLUDED.run_id`,
    values: [
      input.organizationId,
      input.userId,
      input.profileId,
      input.spaceId,
      input.runId,
      Date.now(),
      input.previousRunId,
    ],
  });
  return readFirstWork(db, input);
}
export async function updateFirstWork(
  db: PostgresDatabase,
  input: Scope & {
    runId: string;
    revision: number;
    step: WalkthroughStep;
    paused: boolean;
  }
) {
  await db.query({
    text: "UPDATE openmeld.first_work_experiences SET step = $5, paused = $6, revision = revision + 1 WHERE organization_id = $1 AND user_id = $2 AND run_id = $3 AND revision = $4",
    values: [
      input.organizationId,
      input.userId,
      input.runId,
      input.revision,
      input.step,
      input.paused ? 1 : 0,
    ],
  });
  return readFirstWork(db, input);
}
