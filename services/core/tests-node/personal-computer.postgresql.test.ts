import { expect, it, onTestFinished } from "vitest";
import { ensurePersonalComputer } from "../src/computer/personal-computer";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

it("resolves simultaneous first use to one account-owned identity and keeps other accounts separate", async () => {
  const harness = await createPostgresHarness();
  onTestFinished(() => harness.close());
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
});
