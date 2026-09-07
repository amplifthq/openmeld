import { env, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { verifyRetainedCommandPolling } from "../fixtures/computer-command-workspace";

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
