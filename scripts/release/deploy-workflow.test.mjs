import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const jobName = (component) => component.replaceAll("-", "_");

test("selected jobs accept omitted dependencies but reject failed or cancelled ancestors", () => {
  for (const component of COMPONENTS.filter(
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
    for (const outcome of ["success", "failure", "cancelled"]) {
      const admitted = runInNewContext(job.if, {
        needs,
        always: () => true,
        failure: () => outcome === "failure",
        cancelled: () => outcome === "cancelled",
        contains: (value, item) => value.includes(item),
        fromJSON: JSON.parse,
      });
      assert.equal(
        admitted,
        outcome === "success",
        `${component.name}: ${outcome}`
      );
    }
  }
});

test("deploy.yml has one gated job per component, ordered by the component table", () => {
  assert.deepEqual(
    Object.keys(deploy.jobs)
      .filter((name) => name !== "validate")
      .sort(),
    COMPONENTS.map((component) => jobName(component.name)).sort()
  );
  for (const component of COMPONENTS) {
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

test("production jobs never cancel an active deployment of the same component", () => {
  for (const component of COMPONENTS.filter((entry) => entry.name !== "cli")) {
    const job = deploy.jobs[jobName(component.name)];
    assert.deepEqual(job.concurrency, {
      group: `production-${component.name}`,
      "cancel-in-progress": false,
    });
    assert.equal(job.environment, "production");
  }
  assert.deepEqual(cliRelease.jobs.publish.concurrency, {
    group: "production-cli",
    "cancel-in-progress": false,
  });
});

test("only the validate job checks the SHA, from release control on main", () => {
  const steps = deploy.jobs.validate.steps.map((step) => step.run ?? "");
  assert.ok(
    steps.some((run) => run.includes("require-mainline-release-sha.mjs")),
    "validate must require the SHA on main first-parent history"
  );
  for (const [name, job] of Object.entries(deploy.jobs)) {
    if (name === "validate" || name === "cli") {
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
    assert.ok(
      job.steps.some((step) =>
        String(step.run ?? "").includes(
          "../release-control/scripts/release/deploy-component.mjs"
        )
      ),
      name
    );
  }
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
    }
  }
});

test("the CLI publisher builds the Windows helper in the same run", () => {
  assert.equal(deploy.jobs.cli.uses, "./.github/workflows/cli-release.yml");
  assert.deepEqual(cliRelease.jobs.publish.needs, "windows_helper");
  assert.ok(!JSON.stringify(cliRelease).includes("windows_artifact_run_id"));
  assert.deepEqual(cliRelease.jobs.npm_consumers.needs, "publish");
});
