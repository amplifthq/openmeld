import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type { RemoteAgentLarkPlatformChannelConnectionRecord } from "./lark-platform-channel-connection-repo";

type Connection = Pick<
  RemoteAgentLarkPlatformChannelConnectionRecord,
  "connectionId" | "connectionGeneration"
>;
export async function enabledFeishuHistoryGroups(
  db: PostgresDatabase,
  connection: Connection,
  chatIds: string[]
) {
  const rows = await db.query<{ chat_id: string }>({
    text: "SELECT chat_id FROM openmeld.feishu_group_history_settings WHERE connection_id=$1 AND generation=$2 AND chat_id = ANY($3::text[])",
    values: [connection.connectionId, connection.connectionGeneration, chatIds],
  });
  return new Set(rows.rows.map((row) => row.chat_id));
}
export async function setFeishuGroupHistory(
  db: PostgresDatabase,
  connection: Connection,
  chatId: string,
  enabled: boolean
) {
  const values = [
    connection.connectionId,
    connection.connectionGeneration,
    chatId,
  ];
  if (enabled) {
    await db.query({
      text: "INSERT INTO openmeld.feishu_group_history_settings (connection_id,generation,chat_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
      values,
    });
  } else {
    await db.query({
      text: "DELETE FROM openmeld.feishu_group_history_settings WHERE connection_id=$1 AND generation=$2 AND chat_id=$3",
      values,
    });
  }
}
