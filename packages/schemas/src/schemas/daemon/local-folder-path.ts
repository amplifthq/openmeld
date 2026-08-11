import { profileWorkingDirectorySchema } from "../protocol/profile";

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/u;

export const localFolderPathSchema = profileWorkingDirectorySchema.refine(
  (value) =>
    value.startsWith("/") ||
    value.startsWith("\\\\") ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(value),
  "Enter the full folder path on this computer."
);
