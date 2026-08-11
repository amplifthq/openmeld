import { z } from "zod/v4";
import { signalEnvelopeSchema } from "../protocol/envelope";
import { nonEmptyTrimmedStringFromUnknown } from "../protocol/shared";
import {
  SPACE_UPDATES_DEFAULT_LIMIT,
  SPACE_UPDATES_MAX_LIMIT,
} from "../space-mesh/openmeld-space-action";

const DECIMAL_INTEGER_REGEX = /^\d+$/u;

const updatesLimitSchema = z
  .preprocess((value) => {
    if (value === undefined || value === null || value === "") {
      return SPACE_UPDATES_DEFAULT_LIMIT;
    }
    if (typeof value === "number") {
      return value;
    }
    const normalized = String(value).trim();
    if (normalized.length === 0) {
      return SPACE_UPDATES_DEFAULT_LIMIT;
    }
    if (!DECIMAL_INTEGER_REGEX.test(normalized)) {
      return Number.NaN;
    }
    return Number.parseInt(normalized, 10);
  }, z.number().int().min(1).max(SPACE_UPDATES_MAX_LIMIT))
  .default(SPACE_UPDATES_DEFAULT_LIMIT);

export const getSpaceUpdatesInputSchema = z.strictObject({
  spaceId: nonEmptyTrimmedStringFromUnknown,
  afterSignalId: nonEmptyTrimmedStringFromUnknown,
  limit: updatesLimitSchema,
});

export const getSpaceUpdatesResponseSchema = z.strictObject({
  signals: z.array(signalEnvelopeSchema),
});
