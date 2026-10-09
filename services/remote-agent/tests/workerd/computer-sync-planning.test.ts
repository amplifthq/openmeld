import { env, runInDurableObject } from "cloudflare:test";
import {
  type BackendHandle,
  type SyncProgress,
  Workspace,
} from "@cloudflare/computer";
import { expect, it } from "vitest";

it("bounds native path materialization before the first large-tree sync block", async () => {
  const namespace = (env as { COMPUTER_PROBE: DurableObjectNamespace })
    .COMPUTER_PROBE;
  const stub = namespace.get(namespace.newUniqueId());
  const result = await runInDurableObject(stub, async (_instance, state) => {
    const leafCount = 25_000;
    const pathQueries: { rowsRead: number; returned: number }[] = [];
    const pathQueryPlans: string[] = [];
    const received: string[] = [];
    const unexpected = (): Promise<never> =>
      Promise.reject(
        new Error("The planning probe must not run a shell or pull files")
      );
    const rpc: BackendHandle["rpc"] = {
      shell: {
        exec: unexpected,
        getExec: unexpected,
        killExec: unexpected,
        disposeExec: unexpected,
      },
      // Responses follow the installed vendor SyncRPC types. The peer accepts
      // the SDK's actual stream and acknowledges its exact cursor; it does not
      // manufacture planned entries or a successful shell execution.
      sync: {
        watermarks: async () => ({
          currentRev: 0,
          pushRev: 0,
          fetchCursor: { rev: 0, path: null },
        }),
        push: async ({ senderRev, senderCursor, changes }) => {
          const reader = changes.getReader();
          let applied = 0;
          try {
            for (;;) {
              const entry = await reader.read();
              if (entry.done) {
                break;
              }
              received.push(entry.value.path);
              applied += 1;
            }
          } finally {
            reader.releaseLock();
          }
          return {
            rev: senderRev,
            applied,
            appliedPushCursor: senderCursor ?? { rev: senderRev, path: null },
          };
        },
        fetchChanges: unexpected,
        readEntry: unexpected,
        hasObjects: unexpected,
        fetchObjects: () => {
          throw new Error("Directory planning has no file objects");
        },
        pushObjects: unexpected,
      },
    };
    const workspace = new Workspace({
      storage: {
        sql: {
          exec<Row extends object>(query: string, ...bindings: unknown[]) {
            if (
              query.includes("targets(inode)") &&
              pathQueryPlans.length === 0
            ) {
              pathQueryPlans.push(
                ...state.storage.sql
                  .exec<{ detail: string }>(
                    `EXPLAIN QUERY PLAN ${query}`,
                    ...bindings
                  )
                  .toArray()
                  .map((row) => row.detail)
              );
            }
            const cursor = state.storage.sql.exec(query, ...bindings);
            const rows = cursor.toArray() as Row[];
            if (query.includes("targets(inode)")) {
              pathQueries.push({
                rowsRead: cursor.rowsRead,
                returned: rows.length,
              });
            }
            return { toArray: () => rows };
          },
        },
        transactionSync: (operation) =>
          state.storage.transactionSync(operation),
      },
      backends: [
        {
          id: "planning-peer",
          type: "typed-sync-probe",
          connect: async () => ({
            rpc,
            sync: "remote",
            close: async () => undefined,
          }),
        },
      ],
    });
    try {
      await workspace.ready();
      const directory = `/${Array.from({ length: 20 }, (_, n) => `level-${n}`).join("/")}`;
      await workspace.fs.mkdir(directory, { recursive: true });
      const parent = await workspace.fs.stat(directory);
      // A same-revision fanout is legal in the SDK's sync format. Seed only
      // synthetic directory rows using its installed vfs schema, then run the
      // real public Workspace.push API and its native SQLite planner.
      const inode = state.storage.sql
        .exec<{ inode: number }>("SELECT MAX(inode) AS inode FROM vfs_nodes")
        .one().inode;
      const revision =
        state.storage.sql
          .exec<{ v: number }>("SELECT v FROM vfs_meta WHERE k = 'rev'")
          .one().v + 1;
      if (!parent.isDirectory) {
        throw new Error("The fixture parent must be a directory");
      }
      state.storage.transactionSync(() => {
        state.storage.sql.exec(
          "WITH RECURSIVE sequence(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM sequence WHERE n < ?) INSERT INTO vfs_nodes (inode, type, mode, mtime, rev) SELECT ? + n, 'dir', 493, 0, ? FROM sequence",
          leafCount,
          inode,
          revision
        );
        state.storage.sql.exec(
          "WITH RECURSIVE sequence(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM sequence WHERE n < ?) INSERT INTO vfs_dirents (parent_inode, name, child_inode) SELECT ?, 'leaf-' || printf('%06d', n), ? + n FROM sequence",
          leafCount,
          parent.inode,
          inode
        );
        state.storage.sql.exec(
          "UPDATE vfs_meta SET v = ? WHERE k = 'rev'",
          revision
        );
      });
      const started = Date.now();
      const first = await workspace
        .push("planning-peer")
        [Symbol.asyncIterator]()
        .next();
      if (first.done) {
        throw new Error("The large tree must produce a sync block");
      }
      return {
        leafCount,
        first: first.value as SyncProgress,
        received: received.length,
        pathQueries,
        pathQueryPlans,
        elapsedMs: Date.now() - started,
      };
    } finally {
      await workspace.close();
    }
  });
  expect(result.first.complete).toBe(false);
  expect(result.received).toBe(result.first.entries);
  expect(result.first.cursor.rev).toBe(result.first.targetCursor.rev);
  expect(result.first.cursor.path).not.toBeNull();
  // This fixture has one directory path per inode. Returning every ancestor
  // multiplies materialized JS rows by depth before any bounded block is sent.
  expect(
    Math.max(...result.pathQueries.map((query) => query.returned))
  ).toBeLessThanOrEqual(512);
  console.info(
    "sdk-sync-planning-probe",
    JSON.stringify({
      leafCount: result.leafCount,
      blockEntries: result.first.entries,
      pathQueries: result.pathQueries.length,
      rowsRead: result.pathQueries.reduce(
        (sum, query) => sum + query.rowsRead,
        0
      ),
      maxQueryRowsRead: Math.max(
        ...result.pathQueries.map((query) => query.rowsRead)
      ),
      elapsedMs: result.elapsedMs,
      returnedRows: result.pathQueries.reduce(
        (sum, query) => sum + query.returned,
        0
      ),
      pathQueryPlans: result.pathQueryPlans,
    })
  );
}, 60_000);
