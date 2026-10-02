import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { type DispatchReceipt, init, useModel } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { expect, it, vi } from "vitest";

type SqlValue = string | number | null;
type RuntimeFixture = {
  provenance: { runtime: string; patchSha256: string; synthetic: boolean };
  agent: string;
  conversation: string;
  model: { provider: string; id: string };
  receipts: Record<"completed" | "running" | "queued", DispatchReceipt>;
  tables: Array<{
    name: string;
    sql: string;
    rows: Record<string, SqlValue>[];
  }>;
};

it("resumes actual patched 2.0.3 running and queued submissions without replaying completed tools", async () => {
  const fixture: RuntimeFixture = JSON.parse(
    readFileSync(
      new URL("./fixtures/flue-2.0.3-continuity.json", import.meta.url),
      "utf8"
    )
  );
  expect(fixture.provenance).toMatchObject({
    runtime: "2.0.3",
    synthetic: true,
    patchSha256:
      "2af016a413c955dd981242765b00945562a3fe7c93d32d9b39d70eee0f7bee49",
  });
  const directory = await mkdtemp(join(tmpdir(), "flue-version-continuity-"));
  const database = join(directory, "runtime.sqlite");
  const sql = new DatabaseSync(database);
  for (const table of fixture.tables) {
    sql.exec(table.sql);
    for (const row of table.rows) {
      const columns = Object.keys(row);
      sql
        .prepare(
          `INSERT INTO "${table.name}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
        )
        .run(...columns.map((column) => row[column] ?? null));
    }
  }
  const checkpoints = sql
    .prepare("SELECT format_version FROM flue_conversation_fold_checkpoints")
    .all();
  expect(checkpoints).toContainEqual({ format_version: 2 });
  const leases = sql
    .prepare("SELECT lease_expires_at FROM flue_agent_submissions")
    .all();
  sql.close();

  const now =
    Math.max(Date.now(), ...leases.map((row) => Number(row.lease_expires_at))) +
    120_000;
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  const provider = fauxProvider({
    provider: fixture.model.provider,
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const seenInputs: string[] = [];
  provider.setResponses([
    (context) => {
      const messages = JSON.stringify(context.messages);
      seenInputs.push(messages);
      expect(messages).toContain("Cedar: record-807");
      expect(messages).toContain("Northstar: record-193");
      expect(messages).toContain("Choose the second saved record.");
      return fauxAssistantMessage("Cedar, record-807, selected.");
    },
    (context) => {
      const messages = JSON.stringify(context.messages);
      seenInputs.push(messages);
      expect(messages).toContain("Then remind me of the first record.");
      return fauxAssistantMessage("The first record is Northstar, record-193.");
    },
  ]);
  function UpgradeFixture() {
    useModel(`${fixture.model.provider}/${fixture.model.id}`);
    // No shortlist tool is registered. Its old durable result must suffice;
    // an accidental tool replay cannot silently make this test pass.
    return "Preserve the exact private choices and answer each request separately.";
  }
  UpgradeFixture.durability = { maxAttempts: 5, timeoutMs: 0 };
  UpgradeFixture.joinQueuedDeliveries = false;
  const runtime = await start({
    agents: [UpgradeFixture],
    db: sqlite(database),
    providers: [provider.provider],
  });
  try {
    const agent = init(UpgradeFixture, { id: fixture.conversation });
    await expect(agent.read(fixture.receipts.running)).resolves.toMatchObject({
      text: "Cedar, record-807, selected.",
    });
    await expect(agent.read(fixture.receipts.queued)).resolves.toMatchObject({
      text: "The first record is Northstar, record-193.",
    });
    await expect(agent.read(fixture.receipts.completed)).resolves.toMatchObject(
      {
        text: "The two choices are ready.",
      }
    );
    expect(seenInputs).toHaveLength(2);
  } finally {
    await runtime.stop();
    clock.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
});
