import { describe, expect, it } from "vitest";
import { parseCliJsonResult } from "../src/main/cli/envelope";

describe("parseCliJsonResult", () => {
  it("parses a success envelope and flattens data minus schemaVersion/type", () => {
    const result = parseCliJsonResult({
      stdout:
        '{"schemaVersion":1,"type":"daemon.status","status":"running","pid":42}\n',
      exitCode: 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.type).toBe("daemon.status");
      expect(result.data).toEqual({ status: "running", pid: 42 });
      expect(result.exitCode).toBe(0);
    }
  });

  it("maps a CLI error envelope to a cli_error failure (with requestId)", () => {
    const result = parseCliJsonResult({
      stdout:
        '{"schemaVersion":1,"type":"error","error":{"code":"service.update_required","message":"update","requestId":"req_1"}}\n',
      exitCode: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("cli_error");
      expect(result.error).toEqual({
        code: "service.update_required",
        message: "update",
        requestId: "req_1",
      });
      expect(result.exitCode).toBe(1);
    }
  });

  it("treats a spawn error as spawn_failed", () => {
    const result = parseCliJsonResult({
      stdout: "",
      exitCode: 1,
      spawnError: "failed to launch openmeld: ENOENT",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("spawn_failed");
    }
  });

  it("maps a terminated process to timed_out (ignores partial stdout)", () => {
    const result = parseCliJsonResult({
      stdout: "some partial output\n",
      exitCode: 1,
      terminated: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("timed_out");
    }
  });

  it("returns parse_failed when stdout has no JSON envelope", () => {
    const result = parseCliJsonResult({
      stdout: "not json at all\n",
      exitCode: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("parse_failed");
    }
  });

  it("returns parse_failed for an invalid JSON object line", () => {
    const result = parseCliJsonResult({ stdout: "{bad json}\n", exitCode: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("parse_failed");
    }
  });

  it("returns parse_failed when schemaVersion/type are missing", () => {
    const result = parseCliJsonResult({
      stdout: '{"foo":"bar"}\n',
      exitCode: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("parse_failed");
    }
  });

  it("treats a non-zero exit with a non-error envelope as nonzero_exit", () => {
    const result = parseCliJsonResult({
      stdout: '{"schemaVersion":1,"type":"daemon.stop","status":"warning"}\n',
      exitCode: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("nonzero_exit");
    }
  });

  it("picks the last JSON object line amid leading human noise", () => {
    const result = parseCliJsonResult({
      stdout:
        'Local agent setup is waiting...\n{"schemaVersion":1,"type":"agents.detect","count":2}\n',
      exitCode: 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.type).toBe("agents.detect");
      expect(result.data).toEqual({ count: 2 });
    }
  });

  it("returns parse_failed when the error envelope is malformed", () => {
    const result = parseCliJsonResult({
      stdout: '{"schemaVersion":1,"type":"error"}\n',
      exitCode: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("parse_failed");
      expect(result.error.message).toBe(
        "stdout JSON envelope did not match the CLI --json schema"
      );
    }
  });
});
