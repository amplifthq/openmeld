import { vi } from "vitest";
export const createFinalOutcomeSql = () => {
  const finalReplyClaims = new Map<string, string>();
  const signalRows = new Map<string, { payloadJson: string; ts: number }>();
  const sqlExec = vi.fn((query: string, ...params: unknown[]) => {
    if (query.includes("FROM space_members")) {
      return { toArray: () => [] };
    }
    if (query.includes("SELECT signal_id")) {
      const claimKey = `${String(params[0])}:${String(params[1])}`;
      return {
        toArray: () => [
          ...(finalReplyClaims.has(claimKey)
            ? [{ signal_id: finalReplyClaims.get(claimKey) }]
            : []),
        ],
      };
    }
    if (query.includes("INSERT OR IGNORE INTO space_final_reply_claims")) {
      const claimKey = `${String(params[0])}:${String(params[1])}`;
      if (finalReplyClaims.has(claimKey)) {
        return { rowsWritten: 0 };
      }
      finalReplyClaims.set(claimKey, String(params[2]));
      return { rowsWritten: 1 };
    }
    if (query.includes("INSERT OR IGNORE INTO space_signals")) {
      const signalId = String(params[0]);
      if (signalRows.has(signalId)) {
        return { rowsWritten: 0 };
      }
      signalRows.set(signalId, {
        payloadJson: String(params[6]),
        ts: Number(params[1]),
      });
      return { rowsWritten: 1 };
    }
    if (
      query.includes("FROM space_signals") &&
      query.includes("WHERE id = ?")
    ) {
      const signalId = String(params[0]);
      const row = signalRows.get(signalId);
      return {
        toArray: () =>
          row
            ? [
                {
                  id: signalId,
                  ts: row.ts,
                  payload_json: row.payloadJson,
                },
              ]
            : [],
      };
    }
    if (query.includes("DELETE FROM space_signals")) {
      return { rowsWritten: 0 };
    }
    return { rowsWritten: 1, toArray: () => [] };
  });
  const sql = {
    databaseSize: 0,
    exec: sqlExec,
  } as unknown as SqlStorage;
  return { finalReplyClaims, signalRows, sql, sqlExec };
};
