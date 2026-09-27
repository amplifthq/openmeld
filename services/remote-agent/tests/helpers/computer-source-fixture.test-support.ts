import { DatabaseSync } from "node:sqlite";
import { afterEach } from "vitest";
import { ComputerDataSourceStore } from "../../flue-adapter/computer-data-sources";
import {
  createCloudflareSqlHarness,
  createTransactionRunner,
} from "./cloudflare-sql-harness.test-support";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

export function createComputerSourceFixture() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  const storage = {
    sql: createCloudflareSqlHarness(database) as unknown as SqlStorage,
    transactionSync: createTransactionRunner(database),
  };
  const store = new ComputerDataSourceStore(storage);
  const dataSources = {
    readDataSources: () => Promise.resolve(store.read()),
    recordDataSource: (source: Parameters<typeof store.record>[0]) => {
      store.record(source);
      return Promise.resolve();
    },
  };
  return { database, storage, store, dataSources };
}
