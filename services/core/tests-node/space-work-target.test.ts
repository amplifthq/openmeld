import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SignalEnvelope } from "@openmeld/schemas/types";
import { expect, it } from "vitest";
import { accessSpaceWorkTarget } from "../src/space/application/space-work-target";
import {
  ensureSpaceWorkTargetTable,
  readSpaceWorkTarget,
  selectSpaceWorkTarget,
} from "../src/space/infrastructure/sql/space-work-target-repo";

it("retains the corrected reply goal across restart and continuation without changing the independent OpenMeld task", () => {
  const directory = mkdtempSync(join(tmpdir(), "work-target-"));
  const path = join(directory, "space.sqlite");
  let db = new DatabaseSync(path);
  const sql = () =>
    ({
      exec(query: string, ...params: (string | number)[]) {
        const statement = db.prepare(query);
        if (query.trimStart().startsWith("SELECT")) {
          return { toArray: () => statement.all(...params) };
        }
        statement.run(...params);
        return { toArray: () => [] };
      },
    }) as unknown as SqlStorage;
  const oldTarget = {
    requestGoal: "Review the intent PR",
    codeRepositories: [{ owner: "amplifthq", repo: "openmeld" }],
    issueDestinations: [],
  };
  const scopeKey = "conversation:thread-repository-review";
  try {
    ensureSpaceWorkTargetTable(sql());
    const base = {
      scopeKey,
      sourceRevision: 0,
      requesterProfileId: "requester",
    };
    selectSpaceWorkTarget(sql(), {
      ...base,
      sourceSignalId: "original",
      selection: {
        expectedRevision: 0,
        choice: { kind: "select", target: oldTarget },
      },
    });
    selectSpaceWorkTarget(sql(), {
      ...base,
      scopeKey: "task:openmeld-bug",
      sourceSignalId: "bug",
      selection: {
        expectedRevision: 0,
        choice: { kind: "select", target: oldTarget },
      },
    });
    // Repository-correction regression; member and message identifiers are synthetic.
    const correction = {
      ...base,
      sourceSignalId: "repository-correction",
      selection: {
        expectedRevision: 1,
        choice: {
          kind: "select" as const,
          target: {
            ...oldTarget,
            codeRepositories: [{ owner: "amplifthq", repo: "reply" }],
          },
        },
      },
    };
    const corrected = selectSpaceWorkTarget(sql(), correction);
    expect(selectSpaceWorkTarget(sql(), correction)).toEqual(corrected);
    expect(() =>
      selectSpaceWorkTarget(sql(), {
        ...correction,
        selection: {
          ...correction.selection,
          choice: { kind: "select", target: oldTarget },
        },
      })
    ).toThrow("selection_already_bound");
    db.close();
    db = new DatabaseSync(path);
    const continued = selectSpaceWorkTarget(sql(), {
      ...base,
      sourceSignalId: "continue",
      selection: {
        expectedRevision: corrected.revision,
        choice: { kind: "inherit" },
      },
    });
    expect(continued.target).toEqual(correction.selection.choice.target);
    expect(continued.sourceSignalId).toBe(correction.sourceSignalId);
    expect(readSpaceWorkTarget(sql(), "task:openmeld-bug")?.target).toEqual(
      oldTarget
    );
    expect(() =>
      selectSpaceWorkTarget(sql(), {
        ...base,
        sourceSignalId: "stale",
        selection: {
          expectedRevision: corrected.revision,
          choice: { kind: "select", target: oldTarget },
        },
      })
    ).toThrow("revision_conflict");
    const source = (
      id: string
    ): Extract<SignalEnvelope, { type: "signal.text" }> => ({
      v: 1,
      type: "signal.text",
      id,
      spaceId: "tonebird",
      ts: 1,
      profile: {
        kind: "human",
        profileId: "requester",
        profileName: "Requester",
      },
      data: {
        text: "Review reply rather than openmeld.",
        meta: { messageRevision: 0 },
      },
    });
    const originalSource = source(correction.sourceSignalId);
    const continuationSource = source("continue");
    const sources = new Map([
      [originalSource.id, originalSource],
      [continuationSource.id, continuationSource],
    ]);
    const ownerInput = {
      ...base,
      sourceSignalId: "continue",
      admittedAtMs: 10,
    };
    expect(
      accessSpaceWorkTarget(sql(), ownerInput, (id) => sources.get(id) ?? null)
        ?.target
    ).toEqual(continued.target);
    originalSource.data.meta = {
      messageRevision: 1,
      recalledAt: 123,
    };
    expect(
      accessSpaceWorkTarget(sql(), ownerInput, (id) => sources.get(id) ?? null)
    ).toBeNull();
    expect(readSpaceWorkTarget(sql(), scopeKey)).toBeNull();
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
