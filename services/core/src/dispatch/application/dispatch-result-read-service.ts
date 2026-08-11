import type { DispatchResult } from "@openmeld/schemas/types";
import {
  getDispatchResultByDispatchId,
  getDispatchResultByResultRef,
} from "./dispatch-result-service";

export async function getSpaceDispatchResult(input: {
  db: D1Database;
  spaceId: string;
  dispatchId?: string;
  resultRef?: string;
}): Promise<DispatchResult | null> {
  const dispatchId = normalizeOptionalText(input.dispatchId);
  const resultRef = normalizeOptionalText(input.resultRef);
  const selectorCount =
    Number(Boolean(dispatchId)) + Number(Boolean(resultRef));
  if (selectorCount !== 1) {
    throw new Error("exactly one dispatch result selector is required");
  }

  let result: DispatchResult | null;
  if (dispatchId) {
    result = await getDispatchResultByDispatchId({
      db: input.db,
      dispatchId,
    });
  } else if (resultRef) {
    result = await getDispatchResultByResultRef({
      db: input.db,
      resultRef,
    });
  } else {
    throw new Error("exactly one dispatch result selector is required");
  }

  if (!result || result.spaceId !== input.spaceId) {
    return null;
  }
  return result;
}

function normalizeOptionalText(value: string | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
