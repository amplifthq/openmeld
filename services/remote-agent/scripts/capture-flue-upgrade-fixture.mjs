import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { defineTool, init, useModel, useTool } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { object } from "valibot";

// Run against the specified, unmodified dependency baseline. This
// records real, synthetic runtime state, not hand-authored vendor rows.
const expectedVersion = process.argv[2] ?? "2.0.3";
const service = dirname(dirname(fileURLToPath(import.meta.url)));
const runtimePackage = JSON.parse(
  await readFile(
    join(service, "node_modules/@flue/runtime/package.json"),
    "utf8"
  )
);
if (runtimePackage.version !== expectedVersion) {
  throw new Error(
    `Capture requires the original patched Flue ${expectedVersion} installation.`
  );
}
const patch = await readFile(
  join(service, `../../patches/@flue__runtime@${expectedVersion}.patch`)
);
const directory = await mkdtemp(join(tmpdir(), "openmeld-flue-fixture-"));
const database = join(directory, "runtime.sqlite");
const provider = fauxProvider({
  provider: "upgrade-fixture",
  tokensPerSecond: Number.POSITIVE_INFINITY,
});
const model = provider.getModel();
let lookups = 0;
const lookup = defineTool({
  name: "shortlist",
  description: "Return the saved choices in their original order.",
  input: object({}),
  run() {
    lookups += 1;
    return { output: ["Northstar: record-193", "Cedar: record-807"] };
  },
});
function UpgradeFixture() {
  useModel(`${model.provider}/${model.id}`);
  useTool(lookup);
  return "Preserve the exact private choices and answer each request separately.";
}
UpgradeFixture.durability = { maxAttempts: 5, timeoutMs: 0 };
UpgradeFixture.joinQueuedDeliveries = false;

const waiting = Promise.withResolvers();
const release = Promise.withResolvers();
const responses = [
  fauxAssistantMessage(fauxToolCall("shortlist", {}), {
    stopReason: "toolUse",
  }),
  fauxAssistantMessage("The two choices are ready."),
  ...Array.from({ length: 12 }, (_, index) =>
    fauxAssistantMessage(`Checkpoint ${index + 1}: the choices are unchanged.`)
  ),
  () => {
    waiting.resolve();
    return release.promise;
  },
];
provider.setResponses(responses);
const runtime = await start({
  agents: [UpgradeFixture],
  db: sqlite(database),
  providers: [provider.provider],
});

try {
  const agent = init(UpgradeFixture, { id: "upgrade-continuity" });
  const completed = await agent.dispatch("Read my private shortlist.");
  await agent.read(completed);
  for (let index = 0; index < 12; index += 1) {
    await agent.read(await agent.dispatch(`Remember checkpoint ${index + 1}.`));
  }
  const running = await agent.dispatch("Choose the second saved record.");
  await waiting.promise;
  const queued = await agent.dispatch("Then remind me of the first record.");
  // Back up at a controlled provider boundary while one submission is running
  // and another queued. Opening a separate SQLite reader does not mutate them.
  const reader = new DatabaseSync(database, { readOnly: true });
  try {
    const definitions = reader
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all();
    const tables = definitions.map(({ name, sql }) => ({
      name,
      sql,
      rows: reader.prepare(`SELECT * FROM "${name}"`).all(),
    }));
    const submissions = tables.find(
      (table) => table.name === "flue_agent_submissions"
    );
    if (
      submissions.rows.find((row) => row.submission_id === running.submissionId)
        ?.status !== "running" ||
      submissions.rows.find((row) => row.submission_id === queued.submissionId)
        ?.status !== "queued" ||
      lookups !== 1
    ) {
      throw new Error(
        "Capture did not reach the required single-lookup, running-and-queued boundary."
      );
    }
    const fixture = {
      provenance: {
        runtime: expectedVersion,
        upstreamSource: `v${expectedVersion}`,
        openmeldSource: execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: service,
          encoding: "utf8",
        }).trim(),
        patchSha256: createHash("sha256").update(patch).digest("hex"),
        capturedAt: new Date().toISOString(),
        generator: "scripts/capture-flue-upgrade-fixture.mjs",
        synthetic: true,
      },
      agent: "UpgradeFixture",
      conversation: "upgrade-continuity",
      model: { provider: model.provider, id: model.id },
      receipts: { completed, running, queued },
      tables,
    };
    const output = join(
      service,
      `tests/fixtures/flue-${expectedVersion}-continuity.json`
    );
    await writeFile(output, `${JSON.stringify(fixture, null, 2)}\n`, {
      flag: "wx",
    });
    console.log(
      JSON.stringify({
        output,
        tables: tables.length,
        submissions: submissions.rows.length,
        lookups,
      })
    );
  } finally {
    reader.close();
  }
} finally {
  release.resolve(fauxAssistantMessage("Fixture capture is complete."));
  await runtime.stop();
  await rm(directory, { recursive: true, force: true });
}
