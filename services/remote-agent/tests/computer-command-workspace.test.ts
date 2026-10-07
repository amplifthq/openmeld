import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { verifyDurableCommandResults } from "./fixtures/computer-command-results";
import { verifyRetainedCommandPolling } from "./fixtures/computer-command-workspace";

it("keeps durable results through sync failure and native record expiry", async () => {
  const database = new DatabaseSync(":memory:");
  const sql = {
    exec(query: string, ...bindings: unknown[]) {
      const rows = database.prepare(query).all(...(bindings as never[]));
      const changes = database.prepare("SELECT changes() AS count").get();
      return { toArray: () => rows, rowsWritten: Number(changes?.count ?? 0) };
    },
  };
  try {
    const result = await verifyDurableCommandResults(
      { sql: sql as never, transactionSync: (operation) => operation() },
      sql
    );
    expect(result.pending).toMatchObject({
      status: "running",
      syncPending: true,
      exitCode: 0,
      stdout: "BEGIN\nDONE\n",
    });
    expect(result.recovered).toMatchObject({
      status: "completed",
      stdout: "DONE\n",
      exitCode: 0,
    });
    expect(result.cleanup).toEqual({ unfinished: 0, lostDuringCleanup: false });
    expect(result.starts).toBe(1);
  } finally {
    database.close();
  }
});

it("detaches a live poll through the complete native Workspace stack", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const result = await verifyRetainedCommandPolling({
      sql: {
        exec<Row extends object>(query: string, ...bindings: unknown[]) {
          const rows = database
            .prepare(query)
            .all(...(bindings as never[])) as Row[];
          return { toArray: () => rows };
        },
      },
      transactionSync: (operation) => operation(),
    });
    expect(result.subscribedAfterStartCancel).toBe(false);
    expect(result.subscribedAfterPoll).toBe(false);
    expect(result.syncPending).toMatchObject({
      status: "running",
      after: 4.5,
      exitCode: 0,
    });
    expect(result.stopError).toBe("User stopped execution");
    expect(result.resumedSync).toMatchObject({
      status: "completed",
      after: 5,
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    expect(result.slice).toMatchObject({
      status: "running",
      stdout: "START\n",
      exitCode: null,
    });
    expect(result.finished).toEqual({
      id: result.commandId,
      key: "long",
      status: "completed",
      exitCode: 0,
      stdout: "START\n€",
      stderr: "�",
      after: 5,
    });
  } finally {
    database.close();
  }
});
