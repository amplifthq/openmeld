import { afterEach, describe, expect, it, vi } from "vitest";
import { D1_LOCAL_DB_PATH_ENV_NAME } from "../src/index";
import { runSharedDbMigrate } from "../src/tooling";
import {
  captureDbToolingEnv,
  restoreDbToolingEnv,
} from "./helpers/db-tooling-env.ts";
import {
  createCanonicalSharedLocalFixture,
  DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS,
} from "./helpers/shared-sqlite-fixture.ts";

const originalDbToolingEnv = captureDbToolingEnv();

afterEach(() => {
  restoreDbToolingEnv(originalDbToolingEnv);
  vi.restoreAllMocks();
});

describe("shared db migrate bootstrap", () => {
  it(
    "applies shared db:migrate without depending on local worker sqlite candidates",
    async () => {
      const fixture = createCanonicalSharedLocalFixture(
        "missing-local-candidate",
        "openmeld-shared-bootstrap"
      );
      process.env[D1_LOCAL_DB_PATH_ENV_NAME] = fixture.sqlitePath;
      const sharedLocalWorkerTargets = await import(
        "../src/shared/local-worker-targets.ts"
      );
      const wranglerD1Target = await import(
        "../src/tooling/wrangler-d1-target.ts"
      );
      let migrationApplyCallCount = 0;
      let missingCandidateCallCount = 0;

      vi.spyOn(
        sharedLocalWorkerTargets,
        "resolveSharedLocalWorkerDbTargetLocalPath"
      ).mockImplementation(() => {
        if (missingCandidateCallCount < 2) {
          missingCandidateCallCount += 1;
          throw new wranglerD1Target.MissingLocalWranglerSqliteCandidatesError(
            "/tmp/missing-shared-d1"
          );
        }

        return fixture.sqlitePath;
      });

      try {
        const summary = runSharedDbMigrate({
          mode: "dev",
          runner: ({ args }) => {
            if (args.includes("migrations") && args.includes("apply")) {
              migrationApplyCallCount += 1;
            }

            return {
              status: 0,
              stdout: "",
              stderr: "",
            };
          },
        });

        expect(summary.result).toBe("applied");
        expect(summary.blockedReason).toBeNull();
        expect(missingCandidateCallCount).toBe(0);
        expect(migrationApplyCallCount).toBe(2);
      } finally {
        fixture.cleanup();
      }
    },
    DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS
  );
});
