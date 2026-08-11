const DB_TOOLING_ENV_NAMES = [
  "NODE_ENV",
  "D1_LOCAL_DB_PATH",
  "OPENMELD_DB_EXECUTION_MODE",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_D1_DATABASE_ID",
  "CLOUDFLARE_API_TOKEN",
] as const;

type DbToolingEnvName = (typeof DB_TOOLING_ENV_NAMES)[number];
type DbToolingEnvSnapshot = Record<DbToolingEnvName, string | undefined>;

const unsetEnv = (name: string) => {
  Reflect.deleteProperty(process.env, name);
};

export const captureDbToolingEnv = (): DbToolingEnvSnapshot => {
  return {
    NODE_ENV: process.env.NODE_ENV,
    D1_LOCAL_DB_PATH: process.env.D1_LOCAL_DB_PATH,
    OPENMELD_DB_EXECUTION_MODE: process.env.OPENMELD_DB_EXECUTION_MODE,
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_D1_DATABASE_ID: process.env.CLOUDFLARE_D1_DATABASE_ID,
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
  };
};

export const restoreDbToolingEnv = (snapshot: DbToolingEnvSnapshot): void => {
  for (const envName of DB_TOOLING_ENV_NAMES) {
    const originalValue = snapshot[envName];
    if (typeof originalValue === "undefined") {
      unsetEnv(envName);
      continue;
    }

    process.env[envName] = originalValue;
  }
};
