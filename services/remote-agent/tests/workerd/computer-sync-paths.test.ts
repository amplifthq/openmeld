import { runInDurableObject } from "cloudflare:test";
import {
  type BackendHandle,
  type SyncProgress,
  Workspace,
} from "@cloudflare/computer";
import { expect, it } from "vitest";
import { env } from "./worker-env";

type Change =
  Parameters<
    BackendHandle["rpc"]["sync"]["push"]
  >[0]["changes"] extends ReadableStream<infer Entry>
    ? Entry
    : never;

it("commits ordered file metadata and source progress together under actual workerd", async () => {
  const namespace = (env as { COMPUTER_PROBE: DurableObjectNamespace })
    .COMPUTER_PROBE;
  await runInDurableObject(
    namespace.get(namespace.newUniqueId()),
    async (_instance, state) => {
      let sourceRevision = 1;
      let entries: Change[] = [
        {
          kind: "file",
          rev: 1,
          path: "/transaction.txt",
          mode: 0o644,
          mtime: 1,
          size: 0,
          chunks: [],
        },
      ];
      const unexpected = (): Promise<never> =>
        Promise.reject(new Error("Metadata pull must not execute a command"));
      // Peer responses use the installed vendor SyncRPC contract. Actual dofs
      // application and rollback run against workerd's own SQLite storage/API.
      const rpc: BackendHandle["rpc"] = {
        shell: {
          exec: unexpected,
          getExec: unexpected,
          killExec: unexpected,
          disposeExec: unexpected,
        },
        sync: {
          retentionHead: async () => ({
            epoch: "paths-peer",
            generation: null,
          }),
          beginRetention: () => Promise.resolve(),
          prepareChanges: () => Promise.resolve({ ready: true, reads: 0 }),
          discardChanges: () => Promise.resolve(true),
          watermarks: async () => ({
            currentRev: sourceRevision,
            pushRev: 0,
            fetchCursor: { rev: 0, path: null },
          }),
          fetchChanges: async () => ({
            currentCursor: { rev: sourceRevision, path: null },
            blockCursor: { rev: sourceRevision, path: null },
            drained: true,
            appliedPushCursor: { rev: 0, path: null },
            stream: new ReadableStream({
              start(controller) {
                for (const entry of entries) {
                  controller.enqueue(entry);
                }
                controller.close();
              },
            }),
          }),
          push: unexpected,
          readEntry: unexpected,
          hasObjects: async () => [],
          fetchObjects: () =>
            new ReadableStream({
              start(controller) {
                controller.close();
              },
            }),
          pushObjects: unexpected,
        },
      };
      const owner = new Workspace({
        storage: state.storage as unknown as ConstructorParameters<
          typeof Workspace
        >[0]["storage"],
        backends: [
          {
            id: "transaction-peer",
            type: "typed-sync-peer",
            connect: async () => ({
              rpc,
              sync: "remote" as const,
              close: async () => undefined,
            }),
          },
        ],
      });
      const pull = async () => {
        for await (const _ of owner.pull("transaction-peer")) {
          /* Drive actual SDK metadata application. */
        }
      };
      try {
        await owner.ready();
        const provider = owner.provider();
        owner.db.transactionSync(() => {
          provider.writeFileSync("/outer-before.txt", "before");
          expect(() =>
            owner.db.transactionSync(() => {
              provider.writeFileSync("/rolled-back.txt", "inner");
              throw new Error("inner failure");
            })
          ).toThrow("inner failure");
          expect(provider.existsSync("/rolled-back.txt")).toBe(false);
          provider.writeFileSync("/outer-after.txt", "after");
        });
        expect(provider.readFileSync("/outer-before.txt", "utf8")).toBe(
          "before"
        );
        expect(provider.readFileSync("/outer-after.txt", "utf8")).toBe("after");
        expect(provider.existsSync("/rolled-back.txt")).toBe(false);
        state.storage.sql.exec(
          "CREATE TRIGGER reject_cursor BEFORE INSERT ON _vfs_watermark WHEN NEW.k = 'fetchRev' BEGIN SELECT RAISE(ABORT, 'cursor unavailable'); END"
        );
        await expect(pull()).rejects.toThrow("cursor unavailable");
        expect(await owner.fs.ls("/transaction.txt")).toEqual([]);
        const cursor = state.storage.sql
          .exec<{ v: number }>(
            "SELECT v FROM _vfs_watermark WHERE k = 'fetchRev' AND backend = 'transaction-peer'"
          )
          .toArray();
        expect(cursor[0]?.v ?? 0).toBe(0);
        state.storage.sql.exec("DROP TRIGGER reject_cursor");
        await pull();
        expect(
          await owner.fs.readFile("/transaction.txt", { encoding: "utf8" })
        ).toBe("");
        for (let i = 0; i < 10; i++) {
          await owner.fs.writeFile("/local-clock.txt", `${i}`);
        }
        sourceRevision = 2;
        entries = [{ kind: "delete", rev: 2, path: "/transaction.txt" }];
        await pull();
        expect(await owner.fs.ls("/transaction.txt")).toEqual([]);
      } finally {
        await owner.close();
      }
    }
  );
});

it("preserves aliases, tombstones and same-revision paths across restart and later writes", async () => {
  const namespace = (env as { COMPUTER_PROBE: DurableObjectNamespace })
    .COMPUTER_PROBE;
  const result = await runInDurableObject(
    namespace.get(namespace.newUniqueId()),
    async (_instance, state) => {
      const changes: Change[] = [];
      const objects = new Map<string, Uint8Array>();
      const keyOf = (hash: Uint8Array) => Array.from(hash).join(",");
      let appliedCursor = { rev: 0, path: null as string | null };
      const unexpected = (): Promise<never> =>
        Promise.reject(
          new Error(
            "Sync path validation must not execute a shell or pull files"
          )
        );
      const rpc: BackendHandle["rpc"] = {
        shell: {
          exec: unexpected,
          getExec: unexpected,
          killExec: unexpected,
          disposeExec: unexpected,
        },
        sync: {
          retentionHead: async () => ({
            epoch: "paths-peer",
            generation: null,
          }),
          beginRetention: () => Promise.resolve(),
          discardChanges: () => Promise.resolve(true),
          watermarks: async () => ({
            currentRev: 0,
            pushRev: 0,
            // The receiver's fetch cursor is its acknowledgement of this
            // sender. Advertising zero would correctly trigger SDK reset
            // recovery on reconnect, rather than ordinary retained progress.
            fetchCursor: appliedCursor,
          }),
          push: async ({ senderRev, senderCursor, changes: incoming }) => {
            const reader = incoming.getReader();
            let applied = 0;
            try {
              for (;;) {
                const item = await reader.read();
                if (item.done) {
                  break;
                }
                changes.push(item.value);
                applied += 1;
              }
            } finally {
              reader.releaseLock();
            }
            appliedCursor = senderCursor ?? { rev: senderRev, path: null };
            return {
              rev: senderRev,
              applied,
              appliedPushCursor: appliedCursor,
            };
          },
          hasObjects: async (hashes) =>
            hashes.filter((hash) => objects.has(keyOf(hash))),
          pushObjects: async (incoming) => {
            const reader = incoming.getReader();
            try {
              for (;;) {
                const item = await reader.read();
                if (item.done) {
                  break;
                }
                objects.set(keyOf(item.value.hash), item.value.bytes);
              }
            } finally {
              reader.releaseLock();
            }
          },
          fetchChanges: unexpected,
          readEntry: unexpected,
          fetchObjects: () => {
            throw new Error("This probe only pushes");
          },
        },
      };
      const createOwner = () =>
        new Workspace({
          storage: {
            sql: {
              exec<Row extends object>(query: string, ...bindings: unknown[]) {
                const rows = state.storage.sql
                  .exec(query, ...bindings)
                  .toArray() as Row[];
                return { toArray: () => rows };
              },
            },
            transactionSync: (operation) =>
              state.storage.transactionSync(operation),
          },
          backends: [
            {
              id: "path-peer",
              type: "typed-sync-probe",
              connect: async () => ({
                rpc,
                sync: "remote" as const,
                close: async () => undefined,
              }),
            },
          ],
        });
      let owner = createOwner();
      try {
        await owner.ready();
        await owner.fs.mkdir("/kept");
        await owner.fs.mkdir("/aliases");
        await owner.fs.writeFile("/kept/ユニコード.txt", "before");
        await owner.fs.writeFile("/kept/deleted.txt", "delete me");
        const file = await owner.fs.stat("/kept/ユニコード.txt");
        const aliases = await owner.fs.stat("/aliases");
        // Workspace's public facade has no hardlink mutation. Seed one legal
        // alias through the installed VFS schema, then use its actual public push.
        state.storage.transactionSync(() => {
          state.storage.sql.exec(
            "UPDATE vfs_meta SET v = v + 1 WHERE k = 'rev'"
          );
          state.storage.sql.exec(
            "INSERT INTO vfs_dirents (parent_inode, name, child_inode) VALUES (?, 'hardlink', ?)",
            aliases.inode,
            file.inode
          );
          state.storage.sql.exec(
            "UPDATE vfs_nodes SET rev = (SELECT v FROM vfs_meta WHERE k = 'rev') WHERE inode = ?",
            file.inode
          );
        });
        await owner.fs.symlink("/kept/ユニコード.txt", "/aliases/symlink");
        await owner.fs.mkdir("/move/deep", { recursive: true });
        await owner.fs.writeFile("/move/deep/file.txt", "moved");
        for await (const _progress of owner.push("path-peer")) {
          /* Baseline peer content. */
        }
        const deltaStart = changes.length;
        await owner.fs.rename("/move", "/renamed");
        await owner.fs.rm("/kept/deleted.txt");
        await owner.fs.mkdir("/same-rev");
        const directory = await owner.fs.stat("/same-rev");
        const maxInode = state.storage.sql
          .exec<{ inode: number }>("SELECT MAX(inode) AS inode FROM vfs_nodes")
          .one().inode;
        state.storage.transactionSync(() => {
          state.storage.sql.exec(
            "UPDATE vfs_meta SET v = v + 1 WHERE k = 'rev'"
          );
          state.storage.sql.exec(
            "WITH RECURSIVE sequence(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM sequence WHERE n < 2200) INSERT INTO vfs_nodes (inode, type, mode, mtime, rev) SELECT ? + n, 'dir', 493, 0, (SELECT v FROM vfs_meta WHERE k = 'rev') FROM sequence",
            maxInode
          );
          state.storage.sql.exec(
            "WITH RECURSIVE sequence(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM sequence WHERE n < 2200) INSERT INTO vfs_dirents (parent_inode, name, child_inode) SELECT ?, 'leaf-' || printf('%04d', n), ? + n FROM sequence",
            directory.inode,
            maxInode
          );
        });
        const first = await owner
          .push("path-peer")
          [Symbol.asyncIterator]()
          .next();
        if (first.done || first.value.complete) {
          throw new Error("The shared revision must span multiple sync blocks");
        }
        await owner.close();
        owner = createOwner();
        await owner.ready();
        await owner.fs.writeFile("/kept/ユニコード.txt", "after");
        const resumed: SyncProgress[] = [];
        for await (const progress of owner.push("path-peer")) {
          resumed.push(progress);
        }
        const pendingEnd = changes.length;
        const later: SyncProgress[] = [];
        for await (const progress of owner.push("path-peer")) {
          later.push(progress);
        }
        const laterChanges = changes.slice(pendingEnd);
        return {
          first: first.value,
          resumed,
          later,
          delta: changes
            .slice(deltaStart, pendingEnd)
            .map(({ path, kind }) => ({ path, kind })),
          initialAliases: changes
            .slice(0, deltaStart)
            .filter((entry) => entry.path.startsWith("/aliases/")),
          laterFiles: laterChanges
            .filter((entry) => entry.kind === "file")
            .map((entry) => ({
              path: entry.path,
              rev: entry.rev,
              text:
                entry.kind === "file"
                  ? entry.chunks
                      .map((chunk) =>
                        new TextDecoder().decode(objects.get(keyOf(chunk.hash)))
                      )
                      .join("")
                  : "",
            })),
        };
      } finally {
        await owner.close();
      }
    }
  );
  expect(result.resumed.at(-1)?.complete).toBe(true);
  for (const progress of result.resumed) {
    expect(progress.generation).toBe(result.first.generation);
    expect(progress.targetCursor).toEqual(result.first.targetCursor);
  }
  const leaves = result.delta.filter((entry) =>
    entry.path.startsWith("/same-rev/")
  );
  expect(leaves.map((entry) => entry.path)).toEqual(
    Array.from(
      { length: 2200 },
      (_, index) => `/same-rev/leaf-${String(index + 1).padStart(4, "0")}`
    )
  );
  expect(result.delta).toEqual(
    expect.arrayContaining([
      { path: "/move", kind: "delete" },
      { path: "/move/deep", kind: "delete" },
      { path: "/move/deep/file.txt", kind: "delete" },
      { path: "/kept/deleted.txt", kind: "delete" },
      { path: "/renamed/deep/file.txt", kind: "file" },
    ])
  );
  expect(result.initialAliases).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "/aliases/hardlink", kind: "file" }),
      expect.objectContaining({
        path: "/aliases/symlink",
        kind: "symlink",
        target: "/kept/ユニコード.txt",
      }),
    ])
  );
  expect(result.later.at(-1)?.complete).toBe(true);
  expect(result.laterFiles.map(({ path, text }) => ({ path, text }))).toEqual([
    { path: "/aliases/hardlink", text: "after" },
    { path: "/kept/ユニコード.txt", text: "after" },
  ]);
  expect(
    result.laterFiles.every(
      (entry) => entry.rev > result.first.targetCursor.rev
    )
  ).toBe(true);
}, 60_000);
