import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { parse } from "yaml";
import { COMPONENTS } from "../../release/components.mjs";

const read = (path) =>
  parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));
const deploy = read(".github/workflows/deploy.yml");
const cliRelease = read(".github/workflows/cli-release.yml");
// biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions expression text.
const GITHUB_SHA_EXPRESSION = "${{ github.sha }}";
// biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions expression text.
const INPUT_SHA_EXPRESSION = "${{ inputs.sha }}";
// biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions expression text.
const CLI_INPUT_SHA_EXPRESSION = "${{ inputs.release_sha }}";
const VALIDATED_CLI_SHA_EXPRESSION =
  // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions expression text.
  "${{ needs.validate.outputs.release_sha }}";
const cloudComponents = COMPONENTS.filter((entry) => entry.name !== "cli");
const jobName = (component) => component.replaceAll("-", "_");

test("selected jobs accept omitted dependencies but reject failed or cancelled ancestors", () => {
  for (const component of cloudComponents.filter(
    (entry) => entry.dependsOn.length
  )) {
    const job = deploy.jobs[jobName(component.name)];
    const needs = Object.fromEntries(
      job.needs.map((name) => [name, { result: "skipped" }])
    );
    needs.validate = {
      result: "success",
      outputs: { scopes: `,${component.name},` },
    };
    for (const dependency of component.dependsOn) {
      for (const [result, selected, expected] of [
        ["success", true, true],
        ["skipped", false, true],
        ["skipped", true, false],
        ["failure", true, false],
        ["cancelled", true, false],
      ]) {
        needs[jobName(dependency)].result = result;
        needs.validate.outputs.scopes = `,${component.name},${selected ? `${dependency},` : ""}`;
        const admitted = runInNewContext(job.if, {
          needs,
          always: () => true,
          cancelled: () => false,
          contains: (value, item) => value.includes(item),
        });
        assert.equal(
          admitted,
          expected,
          `${component.name}: ${dependency} ${result}, selected=${selected}`
        );
      }
      needs[jobName(dependency)].result = "skipped";
    }
  }
});

test("deploy.yml has one gated job per cloud component, ordered by the component table", () => {
  assert.deepEqual(
    Object.keys(deploy.jobs)
      .filter((name) => name !== "validate")
      .sort(),
    cloudComponents.map((component) => jobName(component.name)).sort()
  );
  for (const component of cloudComponents) {
    const job = deploy.jobs[jobName(component.name)];
    // Exact delimiters keep "web" from matching "website".
    assert.match(
      job.if,
      new RegExp(`',${component.name},'`, "u"),
      component.name
    );
    assert.deepEqual(
      [job.needs].flat().sort(),
      ["validate", ...component.dependsOn.map(jobName)].sort(),
      component.name
    );
    for (const dependency of component.dependsOn) {
      assert.ok(
        job.if.includes(`needs.${jobName(dependency)}.result`),
        `${component.name} must accept a skipped or successful ${dependency}`
      );
    }
  }
});

test("cloud dispatch rejects CLI and mixed scopes before emitting a deployment selection", () => {
  const directory = mkdtempSync(join(tmpdir(), "openmeld-deploy-scopes-"));
  const step = deploy.jobs.validate.steps.find(
    (entry) => entry.name === "Normalize components"
  );
  try {
    for (const [index, scopes] of [
      "cli",
      "web,cli",
      " cli , auth ",
      "web,website",
    ].entries()) {
      const output = join(directory, `${index}.txt`);
      const result = spawnSync("bash", ["-e", "-c", step.run], {
        cwd: new URL("../../", import.meta.url),
        encoding: "utf8",
        env: { ...process.env, GITHUB_OUTPUT: output, SCOPES: scopes },
      });
      if (scopes === "web,website") {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(readFileSync(output, "utf8"), "scopes=,web,website,\n");
      } else {
        assert.equal(result.status, 1, scopes);
        assert.ok(
          result.stderr.includes(
            "pnpm run deploy -- --scope cli --lane github"
          ),
          result.stderr
        );
        assert.equal(readFileSync(output, "utf8"), "");
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("production jobs never cancel an active deployment of the same component", () => {
  for (const component of cloudComponents) {
    const job = deploy.jobs[jobName(component.name)];
    assert.deepEqual(job.concurrency, {
      group: `production-${component.name}`,
      "cancel-in-progress": false,
      queue: "max",
    });
    assert.equal(job.environment, "production");
  }
  assert.deepEqual(cliRelease.jobs.publish.concurrency, {
    group: "production-cli",
    "cancel-in-progress": false,
    queue: "max",
  });
});

test("only the validate job checks the SHA, from release control on main", () => {
  for (const [workflow, source] of [
    [deploy, INPUT_SHA_EXPRESSION],
    [cliRelease, CLI_INPUT_SHA_EXPRESSION],
  ]) {
    const steps = workflow.jobs.validate.steps;
    const main = steps.find((step) => step.name === "Require main");
    for (const [ref, rejected] of [
      ["refs/heads/main", false],
      ["refs/heads/feature", true],
      ["refs/tags/v1", true],
    ]) {
      assert.equal(runInNewContext(main.if, { github: { ref } }), rejected);
    }
    assert.equal(
      spawnSync("bash", ["-e", "-c", main.run], {
        env: { ...process.env, GITHUB_REF: "refs/heads/feature" },
        encoding: "utf8",
      }).status,
      1
    );
    const checkout = steps.find(
      (step) => step.name === "Checkout release control"
    );
    assert.equal(checkout.with.ref, GITHUB_SHA_EXPRESSION);
    assert.equal(checkout.with["fetch-depth"], 0);
    assert.equal(checkout.with["persist-credentials"], false);
    const refresh = steps.find((step) => step.name === "Refresh current main");
    assert.equal(
      refresh.uses,
      "./release-control/.github/actions/trusted-git-network"
    );
    assert.equal(refresh.with.operation, "fetch-main");
    assert.equal(refresh.with.working_directory, "release-control");
    const guard = steps.find(
      (step) => step.name === "Require the SHA on main first-parent history"
    );
    assert.equal(guard.env.RELEASE_SHA, source);
    assert.equal(guard["working-directory"], "release-control");
    assert.ok(steps.indexOf(refresh) < steps.indexOf(guard));
    if (workflow === cliRelease) {
      assert.equal(
        workflow.jobs.validate.outputs.release_sha,
        `\${{ steps.${guard.id}.outputs.release_sha }}`
      );
      assert.equal(
        guard.run.trim(),
        'set -euo pipefail\nnode scripts/release/require-mainline-release-sha.mjs "$RELEASE_SHA" refs/remotes/origin/main --github-output'
      );
    }
  }
  for (const [name, job] of Object.entries(deploy.jobs)) {
    if (name === "validate") {
      continue;
    }
    const checkouts = job.steps.filter((step) =>
      String(step.uses ?? "").startsWith("actions/checkout")
    );
    assert.deepEqual(
      checkouts.map((step) => [step.with.path, step.with.ref]),
      [
        ["release-control", GITHUB_SHA_EXPRESSION],
        ["release-source", INPUT_SHA_EXPRESSION],
      ],
      name
    );
    const sourceCheckout = checkouts.find(
      (step) => step.with.path === "release-source"
    );
    assert.equal(
      sourceCheckout.with["fetch-depth"],
      0,
      `${name}: signed CLI Skill verification needs origin/main and its history`
    );
    assert.equal(sourceCheckout.with["persist-credentials"], false);
    assert.ok(
      job.steps.some((step) =>
        String(step.run ?? "").includes(
          "../release-control/scripts/release/deploy-component.mjs"
        )
      ),
      name
    );
    assert.equal(
      job.steps.find((step) => step.name === "Setup toolchain").with
        .control_directory,
      "release-control",
      name
    );
  }
  assert.equal(
    cliRelease.jobs.publish.steps.find(
      (step) => step.name === "Setup toolchain"
    ).with.control_directory,
    "release-control"
  );
});

test("database and Core jobs name the PostgreSQL release credentials they need", () => {
  for (const name of ["db", "core"]) {
    const check = deploy.jobs[name].steps.find(
      (step) => step.name === "Require PostgreSQL release credentials"
    );
    for (const secret of [
      "DOPPLER_TOKEN",
      "PLANETSCALE_SERVICE_TOKEN_ID",
      "PLANETSCALE_SERVICE_TOKEN",
    ]) {
      assert.ok(check.run.includes(secret), `${name} ${secret}`);
      assert.ok(check.env[secret], `${name} check receives ${secret}`);
    }
  }
});

test("production secrets are scoped to release steps, not dependency installation", () => {
  for (const job of [
    ...Object.values(deploy.jobs),
    ...Object.values(cliRelease.jobs),
  ]) {
    assert.ok(!JSON.stringify(job.env ?? {}).includes("secrets."));
    for (const step of job.steps ?? []) {
      if (JSON.stringify(step.env ?? {}).includes("secrets.")) {
        assert.ok(
          [
            "Require PostgreSQL release credentials",
            "Build, deploy, and check health",
            "Build, sign, publish, and check the release",
          ].includes(step.name),
          step.name
        );
      }
    }
  }
  for (const entry of cloudComponents) {
    const step = deploy.jobs[jobName(entry.name)].steps.find(
      (step) => step.name === "Build, deploy, and check health"
    );
    assert.ok(step.env.CLOUDFLARE_API_TOKEN, entry.name);
  }
});

test("the top-level CLI publisher gates its helper and OIDC publication on source validation", () => {
  assert.deepEqual(Object.keys(cliRelease.on), ["workflow_dispatch"]);
  assert.equal(
    cliRelease.on.workflow_dispatch.inputs.release_sha.required,
    true
  );
  assert.equal(cliRelease.on.workflow_dispatch.inputs.dry_run.default, false);
  assert.equal(deploy.jobs.cli, undefined);
  assert.deepEqual(cliRelease.jobs.windows_helper.needs, "validate");
  assert.deepEqual(cliRelease.jobs.publish.needs, [
    "validate",
    "windows_helper",
  ]);
  for (const name of ["windows_helper", "publish"]) {
    assert.equal(cliRelease.jobs[name].if, undefined);
  }
  assert.equal(cliRelease.jobs.publish.environment, "production");
  assert.deepEqual(cliRelease.permissions, { contents: "read" });
  assert.deepEqual(cliRelease.jobs.publish.permissions, {
    contents: "write",
    "id-token": "write",
  });
  assert.ok(!JSON.stringify(cliRelease).includes("windows_artifact_run_id"));
  assert.deepEqual(cliRelease.jobs.npm_consumers.needs, [
    "validate",
    "publish",
  ]);
  assert.equal(
    cliRelease.jobs.publish.env.RELEASE_SHA,
    VALIDATED_CLI_SHA_EXPRESSION
  );
  assert.equal(
    cliRelease.jobs.windows_helper.steps.find(
      (step) => step.name === "Setup toolchain"
    ).with.control_directory,
    "release-control"
  );
  for (const name of ["windows_helper", "publish", "npm_consumers"]) {
    const job = cliRelease.jobs[name];
    assert.equal(job.defaults.run["working-directory"], "release-source");
    const checkouts = job.steps.filter((step) =>
      String(step.uses ?? "").startsWith("actions/checkout")
    );
    assert.deepEqual(
      checkouts.map((step) => step.with.path),
      ["release-control"]
    );
    assert.equal(checkouts[0].with.ref, GITHUB_SHA_EXPRESSION);
    assert.equal(checkouts[0].with["fetch-depth"], 0);
    assert.equal(checkouts[0].with["persist-credentials"], false);
    const prepare = job.steps.find(
      (step) => step.name === "Prepare verified release source"
    );
    assert.equal(prepare["working-directory"], "release-control");
    assert.equal(prepare.shell, "bash");
    assert.equal(prepare.env.RELEASE_SHA, VALIDATED_CLI_SHA_EXPRESSION);
    assert.equal(
      prepare.run,
      'node scripts/release/prepare-release-source.mjs "$RELEASE_SHA"'
    );
    assert.deepEqual(job.steps.slice(0, job.steps.indexOf(prepare)), checkouts);
    assert.ok(!JSON.stringify(job).includes("inputs.release_sha"), name);
    for (const step of job.steps.filter((step) =>
      String(step.uses ?? "").includes("artifact@")
    )) {
      assert.equal(
        step.with.name,
        `windows-process-${VALIDATED_CLI_SHA_EXPRESSION}`
      );
    }
    for (const step of job.steps.filter(
      (step) =>
        step !== prepare && String(step.run ?? "").includes("scripts/release/")
    )) {
      assert.ok(step.run.includes("../release-control/scripts/release/"));
      if (name !== "publish") {
        assert.ok(
          step.env.OPENMELD_RELEASE_SOURCE_ROOT.endsWith("/release-source")
        );
      }
    }
  }
});
