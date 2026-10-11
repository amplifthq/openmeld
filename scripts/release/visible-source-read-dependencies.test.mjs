import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildProductionReleasePlan,
  resolveProductionCompatibilityDependencies,
  resolveProductionCompatibilityObligations,
  resolveProductionCompatibilityReceiverWitnesses,
} from "./production-release.mjs";
import { assertProductionStageAdmission } from "./production-stage-admission.mjs";

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/visible-source-read-increment.json", import.meta.url),
    "utf8"
  )
);
const expected = [
  { contract: "visible-source-read", receiver: "core", producer: "gateway" },
  { contract: "visible-source-read", receiver: "gateway", producer: "web" },
];
const PENDING_RECEIVER = /pending prerequisite/u;
const UNKNOWN_RECEIVER = /evidence is unresolved/u;
function context(sourceSha) {
  const reads = [];
  return {
    base: fixture.base,
    sourceSha,
    reads,
    readGitFile(ref, file) {
      reads.push([ref, file]);
      if (![sourceSha, fixture.base].includes(ref)) {
        throw new Error(
          "Read the explicit product source, never control HEAD."
        );
      }
      const caller = fixture.callers.find((item) => item.path === file);
      if (!caller) {
        throw new Error("Uncaptured product owner");
      }
      return caller[ref === fixture.base ? "legacy" : "target"].source;
    },
  };
}
const visibleObligations = (paths, input) =>
  resolveProductionCompatibilityObligations(paths, false, input).filter(
    (item) => item.contract === "visible-source-read"
  );

test("visible-source read real increment requires Core, Gateway, then Web", () => {
  const input = context(fixture.sourceSha);
  assert.deepEqual(visibleObligations(fixture.changedPaths, input), expected);
  assert.ok(input.reads.length > 0);
  assert.ok(input.reads.every(([ref]) => ref === fixture.sourceSha));
  const plan = buildProductionReleasePlan({
    ...fixture,
    ...input,
    scope: "core,gateway,web",
    databaseBackend: "postgresql",
  });
  for (const { receiver, producer } of expected) {
    assert.ok(
      plan.deployScopeOrder.indexOf(receiver) <
        plan.deployScopeOrder.indexOf(producer)
    );
  }

  assert.deepEqual(
    resolveProductionCompatibilityReceiverWitnesses(
      fixture.changedPaths,
      input
    ),
    [],
    "names must not create a compatibility witness"
  );
});

test("visible-source read caller-only changes use the actual target and retain unknown obligations", () => {
  for (const { path } of fixture.callers) {
    for (const input of [
      context(fixture.sourceSha),
      {},
      {
        sourceSha: fixture.sourceSha,
        readGitFile() {
          throw new Error("Unreadable target source");
        },
      },
    ]) {
      assert.deepEqual(visibleObligations([path], input), expected, path);
    }
    assert.deepEqual(
      visibleObligations([path], context(fixture.base)),
      [],
      path
    );
  }
  assert.deepEqual(
    visibleObligations(["clients/website/src/components/footer.tsx"], {}),
    []
  );
});

test("visible-source read receiver-path increments preserve target capability and historical absence", () => {
  for (const path of [
    "packages/schemas/src/schemas/http/inbox.ts",
    "services/core/src/inbox/transport/rpc/inbox-rpc.ts",
    "services/core/src/inbox/application/space-inbox-read.ts",
  ]) {
    assert.deepEqual(
      visibleObligations([path], context(fixture.sourceSha)),
      expected
    );
    assert.deepEqual(visibleObligations([path], context(fixture.base)), []);
  }
});

test("pending or unknown receivers reject visible-source read; other same-pair witnesses cannot replace it", () => {
  for (const obligation of expected) {
    const input = context(fixture.sourceSha);
    const paths = [
      fixture.callers.find(({ path }) =>
        path.startsWith(
          obligation.producer === "web" ? "clients/web/" : "services/gateway/"
        )
      ).path,
    ];
    const receiver = {
      scope: obligation.receiver,
      state: "pending",
      sha: fixture.base,
    };
    const otherContract =
      obligation.producer === "gateway"
        ? "inbox-membership-opt-in"
        : "profile-workspace-read";
    const producer = {
      scope: obligation.producer,
      state: "pending",
      sha: fixture.base,
      compatibilityObligations: resolveProductionCompatibilityObligations(
        paths,
        false,
        input
      ),
      compatibilityDependencies: resolveProductionCompatibilityDependencies(
        paths,
        false,
        input
      ),
      compatibilityReceiverWitnesses: [
        {
          receiver: obligation.receiver,
          producer: obligation.producer,
          contracts: [otherContract],
          evidence: {
            result: "match",
            baselineSha: fixture.base,
            targetSha: fixture.sourceSha,
          },
        },
      ],
    };
    const stage = {
      components: [receiver, producer],
      selectedScopes: [obligation.producer],
      sourceSha: fixture.sourceSha,
    };
    assert.throws(
      () => assertProductionStageAdmission(stage),
      PENDING_RECEIVER
    );
    receiver.state = "unknown";
    assert.throws(
      () => assertProductionStageAdmission(stage),
      UNKNOWN_RECEIVER
    );
    receiver.state = "current";
    receiver.sha = fixture.sourceSha;
    assert.doesNotThrow(() => assertProductionStageAdmission(stage));
  }
});

test("visible-source read proof cannot replace the independent membership obligation", () => {
  const input = context(fixture.sourceSha);
  const paths = [fixture.callers[0].path];
  const obligations = resolveProductionCompatibilityObligations(
    paths,
    false,
    input
  );
  assert.ok(
    obligations.some((item) => item.contract === "inbox-membership-opt-in")
  );
  const stage = {
    sourceSha: fixture.sourceSha,
    selectedScopes: ["gateway"],
    components: [
      { scope: "core", state: "pending", sha: fixture.base },
      {
        scope: "gateway",
        state: "pending",
        sha: fixture.base,
        compatibilityObligations: obligations,
        compatibilityDependencies: resolveProductionCompatibilityDependencies(
          paths,
          false,
          input
        ),
        compatibilityReceiverWitnesses: [
          {
            receiver: "core",
            producer: "gateway",
            contracts: ["visible-source-read"],
            evidence: {
              result: "match",
              baselineSha: fixture.base,
              targetSha: fixture.sourceSha,
            },
          },
        ],
      },
    ],
  };
  assert.throws(() => assertProductionStageAdmission(stage), PENDING_RECEIVER);
});
