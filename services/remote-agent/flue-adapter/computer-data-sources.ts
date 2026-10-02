import {
  type RemoteAgentResultSource,
  remoteAgentResultSourceSchema,
  remoteAgentResultSourcesSchema,
} from "@openmeld/schemas";

/** Internal Computer RPC only; never give this capability to a model or VFS. */
export type ComputerDataSourceAccess = {
  readDataSources(): Promise<RemoteAgentResultSource[]>;
  recordDataSource(source: RemoteAgentResultSource): Promise<void>;
};

/** Computer-owned metadata, not a runtime generation's store or a permission
 * grant. New audience-v2 addresses start empty and never adopt v1 bytes. Once
 * initialized, missing state fails closed instead of recreating an empty list. */
export class ComputerDataSourceStore {
  private readonly storage: Pick<
    DurableObjectStorage,
    "sql" | "transactionSync"
  >;

  constructor(storage: Pick<DurableObjectStorage, "sql" | "transactionSync">) {
    this.storage = storage;
    storage.transactionSync(() => {
      const exists =
        storage.sql
          .exec(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'openmeld_computer_data_sources'"
          )
          .toArray().length > 0;
      if (!exists) {
        storage.sql.exec(
          "CREATE TABLE openmeld_computer_data_sources (id INTEGER PRIMARY KEY CHECK (id = 1), sources TEXT NOT NULL)"
        );
        storage.sql.exec(
          "INSERT INTO openmeld_computer_data_sources (id, sources) VALUES (1, '[]')"
        );
      }
      this.read();
    });
  }

  read(): RemoteAgentResultSource[] {
    const row = this.storage.sql
      .exec<{ sources: string }>(
        "SELECT sources FROM openmeld_computer_data_sources WHERE id = 1"
      )
      .toArray()[0];
    if (!row) {
      throw new Error("remote_agent.computer_provenance_unavailable");
    }
    return remoteAgentResultSourcesSchema.parse(JSON.parse(row.sources));
  }

  record(raw: unknown): void {
    const source = remoteAgentResultSourceSchema.parse(raw);
    if (source.connectionUpdatedAtMs === undefined) {
      throw new Error("remote_agent.computer_source_version_required");
    }
    this.storage.transactionSync(() => {
      const previous = this.read();
      if (
        previous.some(
          (item) =>
            item.service === source.service &&
            item.connectionName === source.connectionName &&
            item.connectionUpdatedAtMs === source.connectionUpdatedAtMs
        )
      ) {
        return;
      }
      const next = remoteAgentResultSourcesSchema.safeParse([
        ...previous,
        source,
      ]);
      if (!next.success) {
        throw new Error(
          "remote_agent.computer_source_limit: Use a fresh conversation for another data source."
        );
      }
      this.storage.sql.exec(
        "UPDATE openmeld_computer_data_sources SET sources = ? WHERE id = 1",
        JSON.stringify(next.data)
      );
    });
  }
}

export async function readComputerDataSources(input: {
  dataSources: ComputerDataSourceAccess;
}) {
  return remoteAgentResultSourcesSchema.parse(
    await input.dataSources.readDataSources()
  );
}

export async function recordComputerDataSource(input: {
  dataSources: ComputerDataSourceAccess;
  source: RemoteAgentResultSource;
}) {
  await input.dataSources.recordDataSource(
    remoteAgentResultSourceSchema.parse(input.source)
  );
}
