import {
  type PluginConnectionContinuationBinding,
  pluginConnectionContinuationBindingSchema,
} from "@openmeld/schemas";
import {
  pluginContinuationConflict,
  samePluginContinuationIntent,
} from "../../application/plugin-connection-continuation-guard";

/** A private binding to an existing idempotent Message. No scheduler, execution
 * status or permissions are owned here. Acceptance is in the message transaction. */
export class PluginConnectionContinuationRepository {
  private readonly sql: SqlStorage;
  constructor(sql: SqlStorage) {
    this.sql = sql;
    // Lazy initialization also covers Spaces whose older schema migration has
    // completed. Neither source messages nor existing files are rewritten.
    sql.exec(
      "CREATE TABLE IF NOT EXISTS plugin_connection_continuations (client_message_id TEXT PRIMARY KEY, binding_json TEXT NOT NULL, signal_id TEXT UNIQUE)"
    );
  }

  read(clientMessageId: string) {
    const row = this.sql
      .exec<{ binding_json: string; signal_id: string | null }>(
        "SELECT binding_json, signal_id FROM plugin_connection_continuations WHERE client_message_id = ?",
        clientMessageId
      )
      .toArray()[0];
    return row
      ? {
          binding: pluginConnectionContinuationBindingSchema.parse(
            JSON.parse(row.binding_json)
          ),
          signalId: row.signal_id,
        }
      : null;
  }

  reserve(clientMessageId: string, value: PluginConnectionContinuationBinding) {
    const binding = pluginConnectionContinuationBindingSchema.parse(value);
    const previous = this.read(clientMessageId);
    if (previous) {
      if (!samePluginContinuationIntent(previous.binding, binding)) {
        throw pluginContinuationConflict();
      }
      // Do not rebind an already accepted message. A pending retry also keeps
      // its original source revision, so edits cannot refresh away the fence.
      return previous;
    }
    this.sql.exec(
      "INSERT INTO plugin_connection_continuations (client_message_id, binding_json, signal_id) VALUES (?, ?, NULL)",
      clientMessageId,
      JSON.stringify(binding)
    );
    return { binding, signalId: null };
  }

  accept(clientMessageId: string, signalId: string) {
    this.sql.exec(
      "UPDATE plugin_connection_continuations SET signal_id = ? WHERE client_message_id = ? AND (signal_id IS NULL OR signal_id = ?)",
      signalId,
      clientMessageId,
      signalId
    );
    if (this.read(clientMessageId)?.signalId !== signalId) {
      throw pluginContinuationConflict();
    }
  }
}
