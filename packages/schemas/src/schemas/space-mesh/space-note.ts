import { z } from "zod/v4";

export const spaceNoteSchema = z.string().trim().min(1);
