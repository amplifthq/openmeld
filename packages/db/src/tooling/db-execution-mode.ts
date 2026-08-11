export type DbExecutionMode = "dev" | "prod";

export const SHARED_DB_EXECUTION_MODE_ENV_NAME =
  "OPENMELD_DB_EXECUTION_MODE" as const;

export const resolveDbExecutionMode = (): DbExecutionMode => {
  const explicitMode = String(
    process.env[SHARED_DB_EXECUTION_MODE_ENV_NAME] ?? ""
  )
    .trim()
    .toLowerCase();

  if (explicitMode === "dev" || explicitMode === "prod") {
    return explicitMode;
  }

  if (explicitMode.length > 0) {
    throw new Error(
      `${SHARED_DB_EXECUTION_MODE_ENV_NAME} must be "dev" or "prod" when it is set.`
    );
  }

  return process.env.NODE_ENV === "production" ? "prod" : "dev";
};
