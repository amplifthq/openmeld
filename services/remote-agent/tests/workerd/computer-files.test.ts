import { runInDurableObject } from "cloudflare:test";
import { Workspace } from "@cloudflare/computer";
import { expect, it } from "vitest";
import { ComputerFiles } from "../../flue-adapter/computer-files";
import { env } from "./worker-env";

it("resolves uncached paths without reading their directory siblings", async () => {
  const namespace = (env as { COMPUTER_PROBE: DurableObjectNamespace })
    .COMPUTER_PROBE;
  await runInDurableObject(
    namespace.get(namespace.newUniqueId()),
    async (_instance, state) => {
      let measuring = false;
      let rowsRead = 0;
      const workspace = new Workspace({
        storage: {
          sql: {
            exec<Row extends object>(query: string, ...bindings: unknown[]) {
              const cursor = state.storage.sql.exec(query, ...bindings);
              const rows = cursor.toArray() as Row[];
              if (measuring) {
                rowsRead += cursor.rowsRead;
              }
              return { toArray: () => rows };
            },
          },
          transactionSync: (operation) =>
            state.storage.transactionSync(operation),
        },
        backends: [],
      });
      try {
        await workspace.ready();
        await workspace.fs.mkdir("/wide");
        const parent = await workspace.fs.stat("/wide");
        const inode = state.storage.sql
          .exec<{ inode: number }>("SELECT MAX(inode) AS inode FROM vfs_nodes")
          .one().inode;
        // Seed a legal wide directory using the installed SDK schema. The
        // measured operation below is the public filesystem, not this fixture.
        state.storage.transactionSync(() => {
          state.storage.sql.exec(
            "WITH RECURSIVE sequence(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM sequence WHERE n < 4096) INSERT INTO vfs_nodes (inode, type, mode, mtime, rev) SELECT ? + n, 'dir', 493, 0, 1 FROM sequence",
            inode
          );
          state.storage.sql.exec(
            "WITH RECURSIVE sequence(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM sequence WHERE n < 4096) INSERT INTO vfs_dirents (parent_inode, name, child_inode) SELECT ?, 'entry-' || printf('%06d', n), ? + n FROM sequence",
            parent.inode,
            inode
          );
        });
        measuring = true;
        for (const name of ["000001", "002048", "004096"]) {
          expect(
            (await workspace.fs.stat(`/wide/entry-${name}`)).isDirectory
          ).toBe(true);
        }
        await expect(workspace.fs.stat("/wide/missing")).rejects.toMatchObject({
          code: "ENOENT",
        });
        await expect(
          workspace.fs.stat("/wide/entry-004096/missing")
        ).rejects.toMatchObject({ code: "ENOENT" });
        // Five shallow path lookups need only their path components. Even a
        // single scan of the 4096 siblings violates this work budget.
        expect(rowsRead).toBeLessThan(512);
      } finally {
        await workspace.close();
      }
    }
  );
});

it("keeps one concurrent edit, rejects the stale edit, and persists files across workspace recreation", async () => {
  const namespace = (env as { COMPUTER_PROBE: DurableObjectNamespace })
    .COMPUTER_PROBE;
  const stub = namespace.get(namespace.newUniqueId());
  await runInDurableObject(stub, async (_instance, state) => {
    const storage = {
      sql: {
        exec<Row extends object>(query: string, ...bindings: unknown[]) {
          const rows = state.storage.sql
            .exec(query, ...bindings)
            .toArray() as Row[];
          return { toArray: () => rows };
        },
      },
      transactionSync: <T>(operation: () => T) =>
        state.storage.transactionSync(operation),
    };
    const workspace = new Workspace({
      storage,
      sessionId: "files",
      backends: [],
    });
    await workspace.ready();
    const files = new ComputerFiles(workspace.fs);
    await files.write("/computer/home/shared.txt", "initial");
    const results = await Promise.allSettled([
      files.execute({
        action: "edit",
        path: "/computer/home/shared.txt",
        oldText: "initial",
        newText: "first",
      }),
      files.execute({
        action: "edit",
        path: "/computer/home/./shared.txt",
        oldText: "initial",
        newText: "second",
      }),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    await expect(
      files.execute({
        action: "write",
        path: "/computer/home/shared.txt",
        expectedContent: "initial",
        content: "overwrite",
      })
    ).rejects.toThrow("file_changed");
    const recreated = new Workspace({
      storage,
      sessionId: "files",
      backends: [],
    });
    await recreated.ready();
    expect(
      await recreated.fs.readFile("/computer/home/shared.txt", "utf8")
    ).toBe("first");
    for (const replaceAll of [false, true]) {
      await files.write("/computer/home/literal.txt", "before TARGET after");
      await files.execute({
        action: "edit",
        path: "/computer/home/literal.txt",
        oldText: "TARGET",
        newText: "literal:$&-$`-$'-$$",
        replaceAll,
      });
      expect(
        await recreated.fs.readFile("/computer/home/literal.txt", "utf8")
      ).toBe("before literal:$&-$`-$'-$$ after");
    }
    await expect(
      files.execute({ action: "read", path: "/computer/../../other" })
    ).rejects.toThrow("path_outside_workspace");
  });
});
