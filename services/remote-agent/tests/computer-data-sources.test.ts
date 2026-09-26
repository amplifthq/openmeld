import { describe, expect, it } from "vitest";
import {
  ComputerDataSourceStore,
  readComputerDataSources,
  recordComputerDataSource,
} from "../flue-adapter/computer-data-sources";
import { createComputerSourceFixture } from "./helpers/computer-source-fixture.test-support";

const source = {
  kind: "plugin_connection" as const,
  service: "github" as const,
  connectionName: "original",
  connectionUpdatedAtMs: 42,
};

describe("Computer-owned provenance survives runtime generations", () => {
  it("persists independent sources across owner restarts without a runtime store or TTL", async () => {
    const f = createComputerSourceFixture();
    await Promise.all([
      recordComputerDataSource({ ...f, source }),
      recordComputerDataSource({
        ...f,
        source: { ...source, connectionName: "other" },
      }),
    ]);
    await recordComputerDataSource({ ...f, source });
    expect(await readComputerDataSources(f)).toHaveLength(2);
    const restarted = new ComputerDataSourceStore(f.storage);
    expect(restarted.read()).toContainEqual(source);
    expect(createComputerSourceFixture().store.read()).toEqual([]);
  });

  it("does not recreate a missing provenance row in an already initialized Computer", () => {
    const f = createComputerSourceFixture();
    f.store.record(source);
    f.database.exec("DELETE FROM openmeld_computer_data_sources");
    expect(() => f.store.read()).toThrow("provenance_unavailable");
    expect(() => new ComputerDataSourceStore(f.storage)).toThrow(
      "provenance_unavailable"
    );
  });

  it("keeps a replaced account version in the source set and refuses unversioned imports", () => {
    const f = createComputerSourceFixture();
    f.store.record(source);
    f.store.record({ ...source, connectionUpdatedAtMs: 43 });
    expect(f.store.read()).toEqual([
      source,
      { ...source, connectionUpdatedAtMs: 43 },
    ]);
    expect(() =>
      f.store.record({ ...source, connectionUpdatedAtMs: undefined })
    ).toThrow("version_required");
  });
});
