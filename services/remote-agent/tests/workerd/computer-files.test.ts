import { env, runInDurableObject } from "cloudflare:test";
import { Workspace } from "@cloudflare/computer";
import { expect, it } from "vitest";
import { ComputerFiles } from "../../flue-adapter/computer-files";

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
