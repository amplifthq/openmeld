import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { verifyIndexedCommandCollection } from "../fixtures/computer-command-collection";
import { verifyDurableCommandResults } from "../fixtures/computer-command-results";
import { verifyRetainedCommandPolling } from "../fixtures/computer-command-workspace";
import { env } from "./worker-env";

it("reads a bounded due batch after indexing historical command receipts under workerd", async () => {
  const namespace = (env as { COMPUTER_PROBE: DurableObjectNamespace })
    .COMPUTER_PROBE;
  const stub = namespace.get(namespace.newUniqueId());
  const result = await runInDurableObject(
    stub,
    async (_instance, state) =>
      await verifyIndexedCommandCollection(state.storage.sql)
  );
  expect(result).toMatchObject({ first: 16, second: 2, next: 0 });
  expect(result.firstRead).toBeLessThan(100);
  expect(result.warmRowsRead).toBeLessThan(100);
});

it.each([
  "complete",
  "ENOENT",
  "EEXEC_LOST",
] as const)("retains the result after sync ends as %s under workerd", async (syncOutcome) => {
  const namespace = (env as { COMPUTER_PROBE: DurableObjectNamespace })
    .COMPUTER_PROBE;
  const stub = namespace.get(namespace.newUniqueId());
  const result = await runInDurableObject(stub, async (_instance, state) => {
    return await verifyDurableCommandResults(
      {
        sql: {
          exec<Row extends object>(query: string, ...bindings: unknown[]) {
            const cursor = state.storage.sql.exec(query, ...bindings);
            return { toArray: () => cursor.toArray() as Row[] };
          },
        },
        transactionSync: (operation) =>
          state.storage.transactionSync(operation),
      },
      state.storage.sql,
      syncOutcome
    );
  });
  expect(result.pending).toMatchObject({
    status: "running",
    syncPending: true,
    exitCode: 0,
  });
  expect(result.pendingCleanup).toEqual({
    unfinished: 1,
    lostDuringCleanup: false,
  });
  expect(result.recovered).toMatchObject({
    status: syncOutcome !== "EEXEC_LOST" ? "completed" : "running",
    stdout: "BEGIN\nDONE\n",
    exitCode: 0,
    ...(syncOutcome !== "EEXEC_LOST"
      ? {}
      : { syncError: syncOutcome, nextAction: "inspect" }),
  });
  expect(result.cleanup).toEqual({ unfinished: 0, lostDuringCleanup: false });
  expect(result.starts).toBe(1);
});

it("detaches and resumes native command output under workerd", async () => {
  const namespace = (env as { COMPUTER_PROBE: DurableObjectNamespace })
    .COMPUTER_PROBE;
  const stub = namespace.get(namespace.newUniqueId());
  const result = await runInDurableObject(stub, async (_instance, state) => {
    return await verifyRetainedCommandPolling({
      sql: {
        exec<Row extends object>(query: string, ...bindings: unknown[]) {
          const rows = state.storage.sql
            .exec(query, ...bindings)
            .toArray() as Row[];
          return { toArray: () => rows };
        },
      },
      transactionSync: (operation) => state.storage.transactionSync(operation),
    });
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
});
