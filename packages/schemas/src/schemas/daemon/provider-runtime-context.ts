import * as z from "zod/v4";
import { MAX_PROFILE_WORKING_DIRECTORY_LENGTH } from "../protocol/profile";

export const providerDispatchRuntimeContextSchema = z.strictObject({
  providerRuntimeWorkingDirectory: z
    .string()
    .trim()
    .min(1)
    .max(MAX_PROFILE_WORKING_DIRECTORY_LENGTH)
    .refine((value) => !value.includes("\u0000"), {
      message: "providerRuntimeWorkingDirectory must not contain NUL bytes",
    }),
});
