import { expect, it, onTestFinished } from "vitest";
import { ensurePersonalComputer } from "../src/computer/personal-computer";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

it("resolves simultaneous first use to one account-owned identity and keeps other accounts separate", async () => {
  const harness = await createPostgresHarness();
  onTestFinished(() => harness.close());
  await harness.db.query(`INSERT INTO "openmeld"."users" (id,name,email,created_at,updated_at)
    VALUES ('human-a','Alex','alex@example.test',1,1),('human-b','Blair','blair@example.test',1,1)`);
  const computers = await Promise.all(
    Array.from({ length: 8 }, () =>
      ensurePersonalComputer(harness.db, "human-a")
    )
  );
  expect(new Set(computers.map((computer) => computer.id)).size).toBe(1);
  expect((await ensurePersonalComputer(harness.db, "human-a")).id).toBe(
    computers[0]?.id
  );
  expect((await ensurePersonalComputer(harness.db, "human-b")).id).not.toBe(
    computers[0]?.id
  );
  await harness.db.query(
    `UPDATE "openmeld"."users" SET deleted_at = 2 WHERE id = 'human-a'`
  );
  await expect(ensurePersonalComputer(harness.db, "human-a")).rejects.toThrow(
    "account_unavailable"
  );
  await harness.db.query(
    `DELETE FROM "openmeld"."cloud_computers" WHERE owner_user_id = 'human-a'`
  );
  await expect(ensurePersonalComputer(harness.db, "human-a")).rejects.toThrow(
    "account_unavailable"
  );
});
