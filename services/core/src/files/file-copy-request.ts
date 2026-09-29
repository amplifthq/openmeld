import { createCoreRpcHttpError } from "../rpc/errors";

export function reserveFileCopyRequest(input: {
  sql: SqlStorage;
  clientMutationId: string;
  requestJson: string;
}): void {
  const existing = input.sql
    .exec<{ request_json: string }>(
      "SELECT request_json FROM file_root_copy_requests WHERE client_mutation_id = ?",
      input.clientMutationId
    )
    .toArray()[0];
  if (existing) {
    if (existing.request_json !== input.requestJson) {
      throw createCoreRpcHttpError({
        code: "file_root.copy_conflict",
        reason: "This request ID was already used for another file copy.",
        status: 409,
      });
    }
    return;
  }
  input.sql.exec(
    "INSERT INTO file_root_copy_requests (client_mutation_id, request_json) VALUES (?, ?)",
    input.clientMutationId,
    input.requestJson
  );
}
