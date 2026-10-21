import { runInDurableObject } from "cloudflare:test";
import {
  type BackendHandle,
  type SyncProgress,
  Workspace,
} from "@cloudflare/computer";
import { expect, it } from "vitest";
import { env } from "./worker-env";

it("returns bounded preparation without materializing or acknowledging the large tree", async () => {
  const namespace = (env as { COMPUTER_PROBE: DurableObjectNamespace })
    .COMPUTER_PROBE;
  const stub = namespace.get(namespace.newUniqueId());
  const result = await runInDurableObject(stub, async (_instance, state) => {
    const leafCount = 25_000;
    const pathQueries: { rowsRead: number; returned: number }[] = [];
    const pathQueryPlans: string[] = [];
    const received: string[] = [];
    let peerCursor: { rev: number; path: string | null } = {
      rev: 0,
      path: null,
    };
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
        retentionHead: async () => ({
          epoch: "planning-peer",
          generation: null,
        }),
        beginRetention: () => Promise.resolve(),
        discardChanges: async () => true,
        watermarks: async () => ({
          currentRev: 0,
          pushRev: peerCursor.rev,
          fetchCursor: peerCursor,
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
          peerCursor = senderCursor ?? { rev: senderRev, path: null };
          return {
            rev: senderRev,
            applied,
            appliedPushCursor: peerCursor,
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
    const createWorkspace = () =>
      new Workspace({
        storage: {
          sql: {
            exec<Row extends object>(query: string, ...bindings: unknown[]) {
              if (
                query.includes("SELECT inode,rev FROM vfs_nodes") &&
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
              if (query.startsWith("SELECT") && !query.includes("EXPLAIN")) {
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
              sync: "remote" as const,
              close: async () => undefined,
            }),
          },
        ],
      });
    let workspace = createWorkspace();
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
      const firstResult = {
        leafCount,
        first: first.value as SyncProgress,
        received: received.length,
        pathQueries: [...pathQueries],
        pathQueryPlans,
        elapsedMs: Date.now() - started,
      };
      // Recreate the SDK owner over the same real DO SQLite storage. A new
      // owner must resume the durable candidate plan, not need an in-memory
      // iterator or acknowledge the unfinished preparation.
      await workspace.close();
      workspace = createWorkspace();
      await workspace.ready();
      let resumedPreparation = false;
      let complete = false;
      let acknowledged = { rev: 0, path: null } as SyncProgress["cursor"];
      let receivedCount = 0;
      for await (const progress of workspace.push("planning-peer")) {
        if (progress.phase === "preparing") {
          resumedPreparation = true;
          expect(received).toHaveLength(receivedCount);
          expect(progress.cursor).toEqual(acknowledged);
        }
        receivedCount = received.length;
        acknowledged = progress.cursor;
        complete = progress.complete;
      }
      const expected = Array.from(
        { length: 20 },
        (_, n) =>
          `/${Array.from({ length: n + 1 }, (_, level) => `level-${level}`).join("/")}`
      );
      for (let n = 1; n <= leafCount; n += 1) {
        expected.push(`${directory}/leaf-${String(n).padStart(6, "0")}`);
      }
      expect(received.sort()).toEqual(expected.sort());
      expect(resumedPreparation).toBe(true);
      expect(complete).toBe(true);
      return firstResult;
    } finally {
      await workspace.close();
    }
  });
  expect(result.first.complete).toBe(false);
  expect(result.first.phase).toBe("preparing");
  expect(result.received).toBe(result.first.entries);
  expect(result.received).toBe(0);
  expect(result.first.cursor).toEqual({ rev: 0, path: null });
  // This fixture has one directory path per inode. Returning every ancestor
  // multiplies materialized JS rows by depth before any bounded block is sent.
  expect(
    Math.max(...result.pathQueries.map((query) => query.returned))
  ).toBeLessThanOrEqual(1);
  expect(
    result.pathQueries.reduce((sum, query) => sum + query.rowsRead, 0)
  ).toBeLessThan(result.leafCount / 2);
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
