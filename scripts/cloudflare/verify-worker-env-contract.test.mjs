import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseJsoncObject } from "../../packages/db/src/tooling/parse-jsonc.ts";

const root = path.resolve(import.meta.dirname, "../..");
const owner = "src/organizations/account-deletion.ts";
const AVATAR_CONTRACT_ERROR =
  /@openmeld\/core (?:top-level|env\.prod).*OPENMELD_ACCOUNT_AVATARS/u;

for (const scenario of [
  "historical-without-owner",
  "owner-missing-binding",
  "owner-wrong-bucket",
]) {
  test(`current verifier validates product-owned Core avatar storage: ${scenario}`, () => {
    const product = mkdtempSync(
      path.join(tmpdir(), "openmeld-worker-env-source-")
    );
    try {
      for (const name of [
        ".github",
        "clients",
        "config",
        "packages",
        "scripts",
        "tooling",
        "release",
      ]) {
        symlinkSync(path.join(root, name), path.join(product, name), "dir");
      }
      mkdirSync(path.join(product, "services"));
      for (const name of readdirSync(path.join(root, "services"))) {
        if (name !== "core") {
          symlinkSync(
            path.join(root, "services", name),
            path.join(product, "services", name),
            "dir"
          );
        }
      }
      const core = path.join(product, "services/core");
      mkdirSync(core);
      for (const name of [
        "package.json",
        "worker-configuration.d.ts",
        ".dev.vars.example",
        ".dev.vars.prod.example",
      ]) {
        copyFileSync(
          path.join(root, "services/core", name),
          path.join(core, name)
        );
      }
      if (scenario !== "historical-without-owner") {
        mkdirSync(path.dirname(path.join(core, owner)), { recursive: true });
        copyFileSync(
          path.join(root, "services/core", owner),
          path.join(core, owner)
        );
      }
      const config = parseJsoncObject(
        readFileSync(path.join(root, "services/core/wrangler.jsonc"), "utf8")
      );
      for (const section of [config, config.env.prod]) {
        if (scenario === "owner-wrong-bucket") {
          section.r2_buckets.find(
            ({ binding }) => binding === "OPENMELD_ACCOUNT_AVATARS"
          ).bucket_name = "wrong-avatar-bucket";
        } else {
          section.r2_buckets = section.r2_buckets.filter(
            ({ binding }) => binding !== "OPENMELD_ACCOUNT_AVATARS"
          );
        }
      }
      writeFileSync(path.join(core, "wrangler.jsonc"), JSON.stringify(config));
      const result = spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          path.join(root, "scripts/cloudflare/verify-worker-env-contract.mjs"),
          "--profile",
          "production",
        ],
        {
          cwd: product,
          env: { ...process.env, OPENMELD_VERIFICATION_ROOT: product },
          encoding: "utf8",
          timeout: 10_000,
        }
      );
      assert.equal(result.error, undefined);
      assert.equal(
        result.status,
        scenario === "historical-without-owner" ? 0 : 1,
        result.stderr
      );
      if (scenario !== "historical-without-owner") {
        assert.match(result.stderr, AVATAR_CONTRACT_ERROR);
      }
    } finally {
      rmSync(product, { recursive: true, force: true });
    }
  });
}
