import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { verifyRetainedCommandPolling } from "./fixtures/computer-command-workspace";

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
