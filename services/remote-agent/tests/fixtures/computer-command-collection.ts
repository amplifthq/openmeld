import {
  COMPUTER_COMMAND_PREFIX,
  ComputerCommandSqlStorage,
} from "../../flue-adapter/computer-command-storage";
import { RemoteAgentSqlStorage } from "../../flue-adapter/storage";

/** Measure the real SQLite cursor, including first index creation on historical
 * receipts. This probe has no command runtime or external execution peer. */
export async function verifyIndexedCommandCollection(sql: SqlStorage) {
  const oldStorage = new RemoteAgentSqlStorage(sql);
  const prefix = `${COMPUTER_COMMAND_PREFIX}native-index:`;
  const receipt = (key: string) => ({
    id: key,
    key,
    fingerprint: key,
    createdAt: 0,
    collectable: false,
    backend: "container",
  });
  for (let index = 0; index < 10_000; index++) {
    await oldStorage.put(`${prefix}old-${index}`, {
      ...receipt(`old-${index}`),
      completed: true,
    });
  }
  for (let index = 0; index < 18; index++) {
    await oldStorage.put(
      `${prefix}due-${String(index).padStart(2, "0")}`,
      receipt(`due-${index}`)
    );
  }
  for (let index = 0; index < 512; index++) {
    await oldStorage.put(`${prefix}future-${index}`, {
      ...receipt(`future-${index}`),
      collection: { unconfirmedAttempts: 0, nextAttemptAtMs: 60_000 },
    });
  }
  const queries: { rowsRead: number; rowsWritten: number; returned: number }[] =
    [];
  const measured = {
    exec(query: string, ...bindings: unknown[]) {
      const cursor = sql.exec(query, ...bindings);
      const rows = cursor.toArray();
      queries.push({
        rowsRead: cursor.rowsRead,
        rowsWritten: cursor.rowsWritten,
        returned: rows.length,
      });
      return { toArray: () => rows, rowsWritten: cursor.rowsWritten };
    },
  };
  const coldAt = Date.now();
  const storage = new ComputerCommandSqlStorage(measured);
  const coldMs = Date.now() - coldAt;
  const coldRowsRead = queries.reduce(
    (total, query) => total + query.rowsRead,
    0
  );
  queries.length = 0;
  const first = await storage.listDueCommands(0, 16);
  const firstRead = queries.reduce((total, query) => total + query.rowsRead, 0);
  for (const [key, command] of first) {
    await storage.compareAndSet(key, command, {
      ...command,
      collection: { unconfirmedAttempts: 1, nextAttemptAtMs: 30_000 },
    });
  }
  queries.length = 0;
  // A new owner reads the same canonical schedule after Worker replacement.
  const reopened = new ComputerCommandSqlStorage(measured);
  const second = await reopened.listDueCommands(0, 16);
  const next = await reopened.nextCollectionAt();
  const warmRowsRead = queries.reduce(
    (total, query) => total + query.rowsRead,
    0
  );
  return {
    historical: 10_000,
    future: 512,
    coldMs,
    coldRowsRead,
    firstRead,
    first: first.size,
    second: second.size,
    next,
    warmRowsRead,
  };
}
