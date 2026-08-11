import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseJsoncObject } from "../../../packages/db/src/tooling/parse-jsonc.ts";

const serviceDirectoryPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const repoRootDirectoryPath = path.resolve(serviceDirectoryPath, "../..");

describe("auth db tooling proxies", () => {
  it("keeps auth predev focused on build + migrate + verify without optimize drift", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(
        path.resolve(serviceDirectoryPath, "package.json"),
        "utf8"
      )
    ) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.predev).toBe(
      'node ../../scripts/dev/run-guarded-service-predev.mjs auth-worker "pnpm -C ../.. exec turbo run build --filter=@openmeld/auth-worker && pnpm run db:migrate:dev && pnpm run db:verify:dev"'
    );
    expect(packageJson.scripts.predev).not.toContain("db:optimize:dev");
  });

  it("keeps services/auth drizzle.config.ts as a thin packages/db wrapper", () => {
    const source = fs.readFileSync(
      path.resolve(serviceDirectoryPath, "drizzle.config.ts"),
      "utf8"
    );

    expect(source).toContain("../../packages/db/drizzle.config");
    expect(source).not.toContain("schema:");
    expect(source).not.toContain("D1_LOCAL_DB_PATH");
  });

  it("keeps service-local db scripts as thin root proxies", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(
        path.resolve(serviceDirectoryPath, "package.json"),
        "utf8"
      )
    ) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["db:check"]).toBe("pnpm -C ../.. db:check");
    expect(packageJson.scripts["db:generate"]).toBe(
      "pnpm -C ../.. db:generate"
    );
    expect(packageJson.scripts["db:migrate:dev"]).toBe(
      "pnpm -C ../.. db:migrate:dev"
    );
    expect(packageJson.scripts["db:migrate:prod"]).toBe(
      "pnpm -C ../.. db:migrate:prod"
    );
    expect(packageJson.scripts["db:verify:dev"]).toBe(
      "pnpm -C ../.. db:verify:dev"
    );
    expect(packageJson.scripts["db:verify:prod"]).toBe(
      "pnpm -C ../.. db:verify:prod"
    );
    expect(packageJson.scripts["db:optimize:dev"]).toBe(
      "pnpm -C ../.. db:optimize:dev"
    );
    expect(packageJson.scripts["db:optimize:prod"]).toBe(
      "pnpm -C ../.. db:optimize:prod"
    );
    expect(packageJson.scripts["db:studio"]).toBe("pnpm -C ../.. db:studio");
    expect(packageJson.scripts["auth:generate"]).toBe(
      "pnpm -C ../.. exec turbo run auth:generate --filter=@openmeld/db"
    );
    expect(packageJson.scripts["db:dev"]).toBeUndefined();
    expect(packageJson.scripts.deploy).toBe(
      "pnpm run build:workspace-dependencies && dotenv -e ../../.env -o -- wrangler deploy --minify --env=prod"
    );
    expect(packageJson.scripts.deploy).not.toContain("db:migrate");
  });

  it("does not expose retired production admin maintenance scripts", () => {
    const authPackageJson = JSON.parse(
      fs.readFileSync(
        path.resolve(serviceDirectoryPath, "package.json"),
        "utf8"
      )
    ) as {
      scripts: Record<string, string>;
    };
    const rootPackageJson = JSON.parse(
      fs.readFileSync(
        path.resolve(repoRootDirectoryPath, "package.json"),
        "utf8"
      )
    ) as {
      scripts: Record<string, string>;
    };
    const retiredAdminScripts = [
      "admin:space-history:audit",
      "admin:space-history:backfill",
      "admin:space-index:backfill",
      "admin:profiles:sweep-deleted",
    ];

    for (const scriptName of retiredAdminScripts) {
      expect(authPackageJson.scripts[scriptName]).toBeUndefined();
      expect(rootPackageJson.scripts[scriptName]).toBeUndefined();
    }

    expect(
      fs.existsSync(
        path.resolve(repoRootDirectoryPath, "scripts-admin/README.md")
      )
    ).toBe(false);
    expect(
      fs.existsSync(
        path.resolve(
          repoRootDirectoryPath,
          "scripts-admin/space-history-admin.mjs"
        )
      )
    ).toBe(false);
    expect(
      fs.existsSync(
        path.resolve(serviceDirectoryPath, "scripts/space-history-admin.mjs")
      )
    ).toBe(false);
    expect(
      fs.existsSync(
        path.resolve(
          serviceDirectoryPath,
          "scripts/space-index-backfill-gate.mjs"
        )
      )
    ).toBe(false);
    expect(
      fs.existsSync(
        path.resolve(serviceDirectoryPath, "scripts/deleted-profile-sweep.mjs")
      )
    ).toBe(false);
    expect(
      fs.existsSync(
        path.resolve(serviceDirectoryPath, "scripts/orphaned-space-sweep.mjs")
      )
    ).toBe(false);
  });

  it("keeps production database release explicit and separate from component deploys", () => {
    const releaseOnMainWorkflow = fs.readFileSync(
      path.resolve(
        repoRootDirectoryPath,
        ".github/workflows/release-on-main.yml"
      ),
      "utf8"
    );
    const authDeployWorkflow = fs.readFileSync(
      path.resolve(
        repoRootDirectoryPath,
        ".github/workflows/deploy-auth-worker.yml"
      ),
      "utf8"
    );
    const coreDeployWorkflow = fs.readFileSync(
      path.resolve(
        repoRootDirectoryPath,
        ".github/workflows/deploy-core-worker.yml"
      ),
      "utf8"
    );
    const sharedDbAction = fs.readFileSync(
      path.resolve(
        repoRootDirectoryPath,
        ".github/actions/shared-db-gate/action.yml"
      ),
      "utf8"
    );

    expect(releaseOnMainWorkflow).toContain("          - database");
    expect(releaseOnMainWorkflow).toContain("          - database-auth");
    expect(releaseOnMainWorkflow).toContain("          - database-core");
    expect(releaseOnMainWorkflow).toContain("          - full");
    expect(releaseOnMainWorkflow).toContain(
      "uses: ./.github/actions/shared-db-gate"
    );
    expect(sharedDbAction).toContain("run: pnpm run db:release:prod");
    expect(releaseOnMainWorkflow).not.toContain("space_index_ready");
    expect(releaseOnMainWorkflow).not.toContain("deploy:space-index-ready");

    for (const workerWorkflow of [authDeployWorkflow, coreDeployWorkflow]) {
      expect(workerWorkflow).not.toContain("run_db_gate");
      expect(workerWorkflow).not.toContain("shared-db-gate");
      expect(workerWorkflow).not.toContain("db:migrate:prod");
    }
  });

  it("keeps auth runtime smoke wrangler config aligned to the shared migration home", () => {
    const wranglerTestConfig = parseJsoncObject<{
      d1_databases: Array<{
        migrations_dir?: string;
      }>;
    }>(
      fs.readFileSync(
        path.resolve(serviceDirectoryPath, "wrangler.test.jsonc"),
        "utf8"
      )
    );

    expect(wranglerTestConfig.d1_databases).toHaveLength(1);
    expect(wranglerTestConfig.d1_databases[0]?.migrations_dir).toBe(
      "../../packages/db/drizzle"
    );
  });

  it("keeps auth local dev KV local", () => {
    const wranglerConfig = parseJsoncObject<{
      kv_namespaces: Array<{
        binding?: string;
        remote?: boolean;
      }>;
    }>(
      fs.readFileSync(
        path.resolve(serviceDirectoryPath, "wrangler.jsonc"),
        "utf8"
      )
    );

    const authKv = wranglerConfig.kv_namespaces.find(
      (binding) => binding.binding === "OPENMELD_AUTH_KV"
    );

    expect(authKv).toBeDefined();
    expect(authKv?.remote).not.toBe(true);
  });
});
