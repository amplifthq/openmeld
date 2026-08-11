import { z } from "zod/v4";

export const MAX_SPACE_NAME_LENGTH = 80 as const;

export const spaceNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_SPACE_NAME_LENGTH);
