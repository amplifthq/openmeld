// biome-ignore-all lint/suspicious/noMisplacedAssertion: This standalone cross-process verifier uses node:assert to fail its CLI exit status, not a test-runner assertion lifecycle.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

// Usage: node scripts/verify-flue-version-rollback.mjs <retained-patched-previous-package>
// Every database is a disposable copy of the checked-in synthetic old fixture.
// Separate processes prevent one version's module globals from helping another.
const script = fileURLToPath(import.meta.url);
const service = dirname(dirname(script));
const [previousPackageArgument, stage, directory] = process.argv.slice(2);
assert.ok(
  previousPackageArgument,
  "Supply the retained patched Flue package directory."
);
const previousPackage = resolve(previousPackageArgument);
const previousMetadata = JSON.parse(
  await readFile(join(previousPackage, "package.json"), "utf8")
);
assert.equal(previousMetadata.name, "@flue/runtime");
assert.ok(["2.0.3", "2.2.2"].includes(previousMetadata.version));
const previousVersion = previousMetadata.version;
const currentMetadata = JSON.parse(
  await readFile(
    join(service, "node_modules/@flue/runtime/package.json"),
    "utf8"
  )
);
const currentVersion = currentMetadata.version;
const fixture = JSON.parse(
  await readFile(
    join(service, `tests/fixtures/flue-${previousVersion}-continuity.json`),
    "utf8"
  )
);
assert.equal(fixture.provenance.runtime, previousVersion);
assert.equal(fixture.provenance.synthetic, true);

if (stage) {
  assert.ok(
    stage === "upgrade" || stage === "rollback",
    "Unknown verification stage."
  );
  assert.ok(directory, "The parent must supply its disposable directory.");
  await runStage(stage, directory);
} else {
  const temporary = await mkdtemp(join(tmpdir(), "openmeld-flue-rollback-"));
  try {
    restoreFixture(join(temporary, "runtime.sqlite"));
    for (const name of ["upgrade", "rollback"]) {
      const child = spawnSync(
        process.execPath,
        [script, previousPackage, name, temporary],
        {
          encoding: "utf8",
          timeout: 45_000,
          maxBuffer: 8 * 1024 * 1024,
        }
      );
      process.stdout.write(child.stdout ?? "");
      process.stderr.write(child.stderr ?? "");
      if (child.error) {
        throw child.error;
      }
      assert.equal(
        child.status,
        0,
        `${name} failed (${child.signal ?? "exit"}).`
      );
    }
    console.log(
      `PASS: patched ${previousVersion} state -> ${currentVersion} writes -> patched ${previousVersion} recovery.`
    );
    console.log(
      "Scope: isolated Node/SQLite processes; not a hosted deployment, Computer, or Core rollback."
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function restoreFixture(database) {
  const sql = new DatabaseSync(database);
  try {
    for (const table of fixture.tables) {
      sql.exec(table.sql);
      for (const row of table.rows) {
        const columns = Object.keys(row);
        sql
          .prepare(
            `INSERT INTO "${table.name}" (${columns.map((name) => `"${name}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
          )
          .run(...columns.map((name) => row[name]));
      }
    }
  } finally {
    sql.close();
  }
}

function inspectDatabase(database) {
  const sql = new DatabaseSync(database, { readOnly: true });
  try {
    return {
      submissions: sql
        .prepare(
          "SELECT submission_id, status, lease_expires_at FROM flue_agent_submissions"
        )
        .all(),
      checkpoints: sql
        .prepare(
          "SELECT format_version FROM flue_conversation_fold_checkpoints"
        )
        .all(),
    };
  } finally {
    sql.close();
  }
}

async function runStage(name, temporary) {
  const database = join(temporary, "runtime.sqlite");
  const receiptsFile = join(temporary, "receipts.json");
  const packageDirectory =
    name === "upgrade"
      ? join(service, "node_modules/@flue/runtime")
      : previousPackage;
  const metadata = JSON.parse(
    await readFile(join(packageDirectory, "package.json"), "utf8")
  );
  assert.equal(
    metadata.version,
    name === "upgrade" ? currentVersion : previousVersion
  );
  const requireRuntime = createRequire(
    join(await realpath(packageDirectory), "package.json")
  );
  let piPackage;
  let piMetadata;
  for (const searchPath of requireRuntime.resolve.paths(
    "@earendil-works/pi-ai"
  ) ?? []) {
    try {
      piPackage = join(searchPath, "@earendil-works/pi-ai");
      piMetadata = JSON.parse(
        await readFile(join(piPackage, "package.json"), "utf8")
      );
      break;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  assert.ok(
    piMetadata,
    "The retained runtime must retain its Pi dependency too."
  );
  const { fauxAssistantMessage, fauxProvider } = await import(
    pathToFileURL(
      join(piPackage, piMetadata.exports["."].import ?? piMetadata.main)
    ).href
  );
  const { init, useModel } = await import(
    pathToFileURL(join(packageDirectory, metadata.exports["."].import)).href
  );
  const { sqlite, start } = await import(
    pathToFileURL(join(packageDirectory, metadata.exports["./node"].import))
      .href
  );
  const before = inspectDatabase(database);
  assert.ok(
    before.checkpoints.some(
      (row) =>
        row.format_version ===
        (name === "upgrade" && previousVersion === "2.0.3" ? 2 : 3)
    )
  );
  // Lease expiry is controlled, not an arbitrary sleep or a state rewrite.
  const originalNow = Date.now;
  const now =
    Math.max(
      originalNow(),
      ...before.submissions.map((row) => Number(row.lease_expires_at))
    ) + 120_000;
  Date.now = () => now;
  const provider = fauxProvider({
    provider: fixture.model.provider,
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const reachedModel = Promise.withResolvers();
  const releaseModel = Promise.withResolvers();
  const respond = (text, required) => (context) => {
    const messages = JSON.stringify(context.messages);
    assert.ok(
      messages.includes("Cedar: record-807"),
      "The original private choice was lost."
    );
    assert.ok(messages.includes(required), `Missing context: ${required}`);
    return fauxAssistantMessage(text);
  };
  if (name === "upgrade") {
    provider.setResponses([
      respond(
        "Cedar, record-807, selected.",
        "Choose the second saved record."
      ),
      respond(
        "The first record is Northstar, record-193.",
        "Then remind me of the first record."
      ),
      ...Array.from({ length: 16 }, (_, index) =>
        respond(`Upgrade checkpoint ${index + 1}.`, "Northstar: record-193")
      ),
      respond(
        "Upgraded runtime saved: receipt-new.",
        "Save the upgraded receipt."
      ),
      () => {
        reachedModel.resolve();
        return releaseModel.promise;
      },
    ]);
  } else {
    provider.setResponses([
      respond("After rollback: Cedar, record-807.", "receipt-new"),
      respond(
        "After rollback: Northstar, record-193.",
        "Recall Northstar after rollback."
      ),
      respond(
        "The upgraded receipt and original choices remain available.",
        "receipt-new"
      ),
    ]);
  }
  function UpgradeFixture() {
    useModel(`${fixture.model.provider}/${fixture.model.id}`);
    // Do not register the old shortlist tool: replay cannot mask lost state.
    return "Preserve the exact private choices and answer each request separately.";
  }
  UpgradeFixture.durability = { maxAttempts: 5, timeoutMs: 0 };
  UpgradeFixture.joinQueuedDeliveries = false;
  const runtime = await start({
    agents: [UpgradeFixture],
    db: sqlite(database),
    providers: [provider.provider],
  });
  try {
    const agent = init(UpgradeFixture, { id: fixture.conversation });
    if (name === "upgrade") {
      assert.equal(
        (await agent.read(fixture.receipts.running)).text,
        "Cedar, record-807, selected."
      );
      assert.equal(
        (await agent.read(fixture.receipts.queued)).text,
        "The first record is Northstar, record-193."
      );
      for (let index = 0; index < 16; index += 1) {
        await agent.read(
          await agent.dispatch(`Keep upgrade checkpoint ${index + 1}.`)
        );
      }
      const completed = await agent.dispatch("Save the upgraded receipt.");
      assert.equal(
        (await agent.read(completed)).text,
        "Upgraded runtime saved: receipt-new."
      );
      const running = await agent.dispatch("Choose Cedar after rollback.");
      await reachedModel.promise;
      const queued = await agent.dispatch("Recall Northstar after rollback.");
      const captured = inspectDatabase(database);
      assert.ok(captured.checkpoints.some((row) => row.format_version === 3));
      assert.equal(
        captured.submissions.find(
          (row) => row.submission_id === running.submissionId
        )?.status,
        "running"
      );
      assert.equal(
        captured.submissions.find(
          (row) => row.submission_id === queued.submissionId
        )?.status,
        "queued"
      );
      await writeFile(
        receiptsFile,
        JSON.stringify({ completed, running, queued })
      );
      console.log(
        "UPGRADE: old state recovered; real format-3 checkpoint and completed/running/queued upgraded work persisted."
      );
      // Deliberately exit at the controlled provider boundary without stop():
      // the old process must recover durable work, not a graceful completion.
      process.exit(0);
    }
    const receipts = JSON.parse(await readFile(receiptsFile, "utf8"));
    assert.equal(
      (await agent.read(receipts.running)).text,
      "After rollback: Cedar, record-807."
    );
    assert.equal(
      (await agent.read(receipts.queued)).text,
      "After rollback: Northstar, record-193."
    );
    assert.equal(
      (await agent.read(receipts.completed)).text,
      "Upgraded runtime saved: receipt-new."
    );
    assert.equal(
      (await agent.read(fixture.receipts.completed)).text,
      "The two choices are ready."
    );
    assert.equal(
      (
        await agent.read(
          await agent.dispatch(
            "Confirm the upgraded receipt is still available."
          )
        )
      ).text,
      "The upgraded receipt and original choices remain available."
    );
    assert.equal(
      provider.state.callCount,
      3,
      "Rollback replayed completed provider work."
    );
    console.log(
      "ROLLBACK: old patched runtime read the upgraded checkpoint, recovered both pending requests once, read both generations' results, and continued the same conversation."
    );
  } finally {
    releaseModel.resolve(fauxAssistantMessage("Verification cleanup."));
    await runtime.stop();
    Date.now = originalNow;
  }
}
