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

  it("keeps production database release explicit and separate from component deploys", async () => {
    const { COMPONENTS } = (await import(
      path.resolve(repoRootDirectoryPath, "release/components.mjs")
    )) as {
      COMPONENTS: Array<{ name: string; deploy: (sha: string) => string[][] }>;
    };
    const steps = (name: string) =>
      COMPONENTS.find((component) => component.name === name)
        ?.deploy("a".repeat(40))
        .map((command) => command.join(" ")) ?? [];

    expect(steps("db")).toEqual([
      "node tooling/postgresql/cutover.mjs migrate",
      "node tooling/postgresql/cutover.mjs grant-runtime",
    ]);
    for (const worker of ["auth", "core"]) {
      expect(steps(worker).length).toBeGreaterThan(0);
      for (const command of steps(worker)) {
        expect(command).not.toContain("migrate");
        expect(command).not.toContain("cutover.mjs");
      }
    }
  });

  it("keeps auth runtime smoke on native PostgreSQL without a D1 fallback", () => {
    const wranglerTestConfig = parseJsoncObject<{
      d1_databases?: unknown[];
      hyperdrive: Array<{
        binding: string;
        localConnectionString?: string;
      }>;
    }>(
      fs.readFileSync(
        path.resolve(serviceDirectoryPath, "wrangler.test.jsonc"),
        "utf8"
      )
    );

    expect(wranglerTestConfig.d1_databases).toBeUndefined();
    expect(wranglerTestConfig.hyperdrive).toHaveLength(1);
    expect(wranglerTestConfig.hyperdrive[0]?.binding).toBe(
      "OPENMELD_POSTGRESQL"
    );
    // The runtime harness injects its fresh isolated PostgreSQL URL.
    expect(
      wranglerTestConfig.hyperdrive[0]?.localConnectionString
    ).toBeUndefined();
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
