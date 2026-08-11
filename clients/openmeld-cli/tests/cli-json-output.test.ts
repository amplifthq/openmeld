import { describe, expect, it } from "vitest";
import { emitCliJsonEnvelope } from "../src/runtime/cli-json-output";
import { withCapturedStdio } from "./helpers/fs";

describe("cli --json output envelope emit", () => {
  it("emits exactly one JSON line", async () => {
    const { stdout } = await withCapturedStdio(() =>
      Promise.resolve(
        emitCliJsonEnvelope({
          schemaVersion: 1,
          type: "daemon.run",
          ok: true,
        })
      )
    );
    const lines = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(lines).toHaveLength(1);
  });

  it("emits the envelope byte-faithfully, preserving key order and flattened domain fields", async () => {
    const envelope = {
      schemaVersion: 1,
      type: "daemon.stop",
      status: "stopped",
      runtimeStatus: { mode: "background", pid: 123 },
    } as const;
    const { stdout } = await withCapturedStdio(() =>
      Promise.resolve(emitCliJsonEnvelope(envelope))
    );
    // Wire bytes must be the original object verbatim (key order intact, the
    // relaxed/flattened domain fields preserved, not stripped by validation).
    expect(stdout.trim()).toBe(JSON.stringify(envelope));
    expect(JSON.parse(stdout.trim())).toEqual(envelope);
  });

  it("fails open: an envelope that fails contract validation is still emitted byte-faithfully and stays silent on stderr", async () => {
    // An envelope the shared schema rejects (unknown discriminant). The
    // fail-open guarantee: a contract gap must never alter or suppress
    // already-published --json stdout, and must not surface by default.
    const invalid = {
      schemaVersion: 1,
      type: "totally.unknown.type",
      whatever: true,
    };
    const previousDebug = process.env.OPENMELD_DEBUG_CLI_JSON;
    Reflect.deleteProperty(process.env, "OPENMELD_DEBUG_CLI_JSON");
    try {
      const { stdout, stderr } = await withCapturedStdio(() =>
        Promise.resolve(emitCliJsonEnvelope(invalid as never))
      );
      expect(stdout.trim()).toBe(JSON.stringify(invalid));
      expect(stderr).toBe("");
    } finally {
      restoreEnv("OPENMELD_DEBUG_CLI_JSON", previousDebug);
    }
  });

  it("surfaces a validation miss on stderr only under OPENMELD_DEBUG_CLI_JSON=1, never touching stdout", async () => {
    const invalid = {
      schemaVersion: 1,
      type: "totally.unknown.type",
      whatever: true,
    };
    const previousDebug = process.env.OPENMELD_DEBUG_CLI_JSON;
    process.env.OPENMELD_DEBUG_CLI_JSON = "1";
    try {
      const { stdout, stderr } = await withCapturedStdio(() =>
        Promise.resolve(emitCliJsonEnvelope(invalid as never))
      );
      expect(stdout.trim()).toBe(JSON.stringify(invalid));
      expect(stderr).toContain(
        "--json envelope failed shared contract validation"
      );
    } finally {
      restoreEnv("OPENMELD_DEBUG_CLI_JSON", previousDebug);
    }
  });
});

function restoreEnv(key: string, previous: string | undefined): void {
  if (previous === undefined) {
    Reflect.deleteProperty(process.env, key);
    return;
  }
  process.env[key] = previous;
}
