import { describe, expect, it } from "vitest";
import {
  appendBoundedOpenMeldToolsUpdateProcessOutput,
  emitOpenMeldToolsUpdateFailureFrame,
  parseOpenMeldToolsUpdateFailureFrame,
} from "../src/local-service/maintenance/openmeld-tools-update-process-frame";
import { CliBinaryUpdateError } from "../src/runtime/cli-binary-update-artifact";
import { withCapturedStdio } from "./helpers/fs";

describe("OpenMeld Tools update process failure frame", () => {
  it("carries a typed safe failure separately from bounded local detail", async () => {
    const localDetail = "socket closed at /private/local/path";
    const error = new CliBinaryUpdateError({
      allowFullFallback: true,
      kind: "download_stalled",
      message: localDetail,
      retryable: true,
    });

    const { stdout } = await withCapturedStdio(() => {
      emitOpenMeldToolsUpdateFailureFrame(error);
      return Promise.resolve();
    });

    const parsed = parseOpenMeldToolsUpdateFailureFrame(stdout);
    expect(parsed).toEqual({
      detail: localDetail,
      failureCode: "cli.update.download_stalled",
    });
  });

  it("ignores arbitrary output and unallowlisted frames", () => {
    expect(
      parseOpenMeldToolsUpdateFailureFrame(
        [
          "ordinary worker output",
          JSON.stringify({
            detail: "secret",
            failureCode: "cli.update.raw_stderr",
            schema: "openmeld-tools-update-process-failure-v1",
            v: 1,
          }),
        ].join("\n")
      )
    ).toBeNull();
  });

  it("retains a final frame after bounding noisy process output", async () => {
    const { stdout } = await withCapturedStdio(() => {
      emitOpenMeldToolsUpdateFailureFrame(
        new Error("local detail remains bounded")
      );
      return Promise.resolve();
    });
    const bounded = appendBoundedOpenMeldToolsUpdateProcessOutput(
      "x".repeat(70 * 1024),
      stdout
    );

    expect(bounded.length).toBeLessThanOrEqual(64 * 1024);
    expect(parseOpenMeldToolsUpdateFailureFrame(bounded)).toMatchObject({
      failureCode: "cli.update.failed",
    });
  });
});
