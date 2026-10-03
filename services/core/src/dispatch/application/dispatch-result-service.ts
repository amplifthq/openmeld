import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type { DispatchResult } from "@openmeld/schemas/types";
import {
  readDispatchResultByDispatchId,
  readDispatchResultByResultRef,
  upsertDispatchResult,
} from "../infrastructure/postgresql/dispatch-result-repo";
export const writeDispatchResult = async (input: {
  db: PostgresDatabase;
  result: DispatchResult;
}): Promise<void> => {
  await upsertDispatchResult(input.db, input.result);
};
export const getDispatchResultByDispatchId = async (input: {
  db: PostgresDatabase;
  dispatchId: string;
}): Promise<DispatchResult | null> => {
  return await readDispatchResultByDispatchId(input.db, input.dispatchId);
};
export const getDispatchResultByResultRef = async (input: {
  db: PostgresDatabase;
  resultRef: string;
}): Promise<DispatchResult | null> => {
  return await readDispatchResultByResultRef(input.db, input.resultRef);
};
