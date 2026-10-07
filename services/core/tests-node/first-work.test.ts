import { describe, expect, it, onTestFinished } from "vitest";
import {
  hasStartedTutorial,
  readFirstWork,
  reserveFirstWork,
  updateFirstWork,
} from "../src/onboarding/first-work";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("tutorial progress", () => {
  it("resumes one reserved Space after concurrent starts or a lost response without crossing workspace/account boundaries", async () => {
    const harness = await createPostgresHarness();
    onTestFinished(() => harness.close());
    await harness.query(
      "INSERT INTO openmeld.users (id, name, email) VALUES ('user-a', 'A', 'a@example.test'), ('user-b', 'B', 'b@example.test')"
    );
    await harness.query(
      "INSERT INTO openmeld.organizations (id, name, slug, created_at) VALUES ('org-a', 'A', 'a', 0), ('org-b', 'B', 'b', 0)"
    );
    const scope = {
      organizationId: "org-a",
      userId: "user-a",
      profileId: "profile-a",
      runId: crypto.randomUUID(),
      previousRunId: null,
    };
    expect(await hasStartedTutorial(harness.db, scope.userId)).toBe(false);
    const [first, second] = await Promise.all([
      reserveFirstWork(harness.db, { ...scope, spaceId: "a".repeat(64) }),
      reserveFirstWork(harness.db, { ...scope, spaceId: "b".repeat(64) }),
    ]);
    if (!(first && second)) {
      throw new Error("Missing reservation");
    }
    expect(first.spaceId).toBe(second.spaceId);
    expect(first.step).toBe("create-space");
    // Admission is account-scoped; a run still belongs to one workspace.
    expect(await hasStartedTutorial(harness.db, scope.userId)).toBe(true);
    expect(await hasStartedTutorial(harness.db, "user-b")).toBe(false);
    expect(
      await readFirstWork(harness.db, { ...scope, userId: "user-b" })
    ).toBeNull();
    expect(
      await readFirstWork(harness.db, { ...scope, organizationId: "org-b" })
    ).toBeNull();
    const paused = await updateFirstWork(harness.db, {
      ...scope,
      revision: 0,
      step: "first-task",
      paused: true,
    });
    await updateFirstWork(harness.db, {
      ...scope,
      revision: 0,
      step: "create-space",
      paused: false,
    });
    expect(await readFirstWork(harness.db, scope)).toEqual(paused);
    const resumed = await reserveFirstWork(harness.db, {
      ...scope,
      spaceId: "c".repeat(64),
    });
    expect(resumed).toEqual({
      ...first,
      step: "first-task",
      paused: true,
      revision: 1,
    });
    const replayId = crypto.randomUUID();
    const replayInput = {
      ...scope,
      spaceId: "d".repeat(64),
      runId: replayId,
      previousRunId: scope.runId,
    };
    const replay = await reserveFirstWork(harness.db, replayInput);
    expect(replay).toMatchObject({
      runId: replayId,
      spaceId: "d".repeat(64),
      iteration: 2,
      step: "create-space",
      paused: false,
    });
    expect(await reserveFirstWork(harness.db, replayInput)).toEqual(replay);
    await updateFirstWork(harness.db, {
      ...scope,
      revision: 1,
      step: "complete",
      paused: false,
    });
    expect(await readFirstWork(harness.db, scope)).toEqual(replay);
    const count = await harness.query(
      "SELECT count(*)::int AS count FROM openmeld.first_work_experiences"
    );
    expect(count.rows[0].count).toBe(1);
  });
});
