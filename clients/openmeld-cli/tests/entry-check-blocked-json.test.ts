import { cliJsonEntryCheckBlockedErrorCodeSchema } from "@openmeld/schemas";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyEntryCheckResult,
  buildBlockedEntryCheckResult,
  ENTRY_CHECK_BLOCKED_ERROR_CODES,
} from "../src/command-entry-checks/entry-check-blocked-json";
import { withCapturedStdio } from "./helpers/fs";

function parseStdoutLines(stdout: string): unknown[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

describe("entry-check blocked json", () => {
  const previousExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = previousExitCode;
  });

  it("maps blocked entry checks to stable error codes", () => {
    expect(ENTRY_CHECK_BLOCKED_ERROR_CODES).toEqual({
      signIn: "auth.authentication_required",
      signInUnavailable: "auth.session_token_unavailable",
      selectedProfile: "profile.required",
      localRuntimeState: "local_state.repair_required",
      cliUpdate: "upgrade.required",
    });
  });

  it("builds a blocked result carrying the json error", () => {
    expect(
      buildBlockedEntryCheckResult({
        code: ENTRY_CHECK_BLOCKED_ERROR_CODES.signIn,
        message: "Run `openmeld login`.",
      })
    ).toEqual({
      status: "blocked",
      exitCode: 1,
      jsonError: {
        code: "auth.authentication_required",
        message: "Run `openmeld login`.",
      },
    });
  });

  it("emits one canonical error envelope and sets exit code 1 under --json", async () => {
    const { stdout, result } = await withCapturedStdio(() =>
      Promise.resolve(
        applyEntryCheckResult({
          result: buildBlockedEntryCheckResult({
            code: ENTRY_CHECK_BLOCKED_ERROR_CODES.signIn,
            message: "Run `openmeld login`.",
          }),
          jsonOutput: true,
        })
      )
    );

    expect(result).toBe(false);
    expect(process.exitCode).toBe(1);
    const lines = parseStdoutLines(stdout);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      schemaVersion: 1,
      type: "error",
      error: {
        code: "auth.authentication_required",
        message: "Run `openmeld login`.",
      },
    });
  });

  it("forwards a requestId into the envelope when present", async () => {
    const { stdout } = await withCapturedStdio(() =>
      Promise.resolve(
        applyEntryCheckResult({
          result: buildBlockedEntryCheckResult({
            code: ENTRY_CHECK_BLOCKED_ERROR_CODES.localRuntimeState,
            message: "local OpenMeld data needs repair",
            requestId: "req_123",
          }),
          jsonOutput: true,
        })
      )
    );

    const lines = parseStdoutLines(stdout);
    expect(lines[0]).toEqual({
      schemaVersion: 1,
      type: "error",
      error: {
        code: "local_state.repair_required",
        message: "local OpenMeld data needs repair",
        requestId: "req_123",
      },
    });
  });

  it("keeps an unavailable saved sign-in structured without changing the v1 envelope", async () => {
    const { stdout } = await withCapturedStdio(() =>
      Promise.resolve(
        applyEntryCheckResult({
          result: buildBlockedEntryCheckResult({
            code: ENTRY_CHECK_BLOCKED_ERROR_CODES.signInUnavailable,
            message:
              "Saved sign-in is temporarily unavailable. Diagnostic: macOS Keychain helper timed out after 5000ms",
          }),
          jsonOutput: true,
        })
      )
    );

    const lines = parseStdoutLines(stdout);
    expect(lines[0]).toEqual({
      schemaVersion: 1,
      type: "error",
      error: {
        code: "auth.session_token_unavailable",
        message:
          "Saved sign-in is temporarily unavailable. Diagnostic: macOS Keychain helper timed out after 5000ms",
      },
    });
  });

  it("does not emit an envelope when blocked outside --json", async () => {
    const { stdout, result } = await withCapturedStdio(() =>
      Promise.resolve(
        applyEntryCheckResult({
          result: buildBlockedEntryCheckResult({
            code: ENTRY_CHECK_BLOCKED_ERROR_CODES.signIn,
            message: "Run `openmeld login`.",
          }),
          jsonOutput: false,
        })
      )
    );

    expect(result).toBe(false);
    expect(process.exitCode).toBe(1);
    expect(stdout.trim()).toBe("");
  });

  it("lets the command body run on continue without touching the exit code", async () => {
    const { stdout, result } = await withCapturedStdio(() =>
      Promise.resolve(
        applyEntryCheckResult({
          result: { status: "continue" },
          jsonOutput: true,
        })
      )
    );

    expect(result).toBe(true);
    expect(process.exitCode).toBe(previousExitCode);
    expect(stdout.trim()).toBe("");
  });

  it("keeps the entry-check code map in exact sync with the shared schema enum", () => {
    // The `satisfies` binding on ENTRY_CHECK_BLOCKED_ERROR_CODES only enforces a
    // SUBSET relation at compile time. Assert exact set-equality at runtime so
    // the two lists cannot drift apart (a new schema enum member with no mapping,
    // or a mapped code dropped from the enum) while both suites stay green.
    const mappedCodes = [
      ...new Set(Object.values(ENTRY_CHECK_BLOCKED_ERROR_CODES)),
    ].sort();
    const schemaEnumCodes = [
      ...cliJsonEntryCheckBlockedErrorCodeSchema.options,
    ].sort();
    expect(mappedCodes).toEqual(schemaEnumCodes);
  });
});
