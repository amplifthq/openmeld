import type { DispatchResult } from "@openmeld/schemas/types";
import {
  readDispatchResultByDispatchId,
  readDispatchResultByResultRef,
  upsertDispatchResult,
} from "../infrastructure/d1/dispatch-result-repo";

export const writeDispatchResult = async (input: {
  db: D1Database;
  result: DispatchResult;
}): Promise<void> => {
  await upsertDispatchResult(input.db, input.result);
};

export const getDispatchResultByDispatchId = async (input: {
  db: D1Database;
  dispatchId: string;
}): Promise<DispatchResult | null> => {
  return await readDispatchResultByDispatchId(input.db, input.dispatchId);
};

export const getDispatchResultByResultRef = async (input: {
  db: D1Database;
  resultRef: string;
}): Promise<DispatchResult | null> => {
  return await readDispatchResultByResultRef(input.db, input.resultRef);
};
