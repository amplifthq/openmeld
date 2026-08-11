import path from "node:path";
import { getRepoRootDirectoryPath } from "../auth/paths.ts";
import { SHARED_DB_SCHEMA_ENTRYPOINT_PATH } from "./fact-metadata.ts";

export const getSharedDbSchemaEntryPointAbsolutePath = (): string => {
  return path.resolve(
    getRepoRootDirectoryPath(),
    SHARED_DB_SCHEMA_ENTRYPOINT_PATH
  );
};
