import { describe, expect, it } from "vitest";
import {
  buildReadLedgerStatusFailedHealthReport,
  toRedactedSpaceErrorMessage,
} from "../space/transport/do/space-error-reporting";

describe("space error reporting", () => {
  it("redacts space passwords before surfacing error text", () => {
    const error = new Error("request failed");
    error.stack = [
      'Error: request failed {"x-openmeld-space-password":"secret-json"}',
      "x-openmeld-space-password=secret-text",
    ].join("\n");

    const errorMessage = toRedactedSpaceErrorMessage(error);

    expect(errorMessage).toContain("<redacted>");
    expect(errorMessage).not.toContain("secret-json");
    expect(errorMessage).not.toContain("secret-text");
  });

  it("uses one redacted error message for the outbox ledger health report", () => {
    const report = buildReadLedgerStatusFailedHealthReport({
      error: new Error("x-openmeld-space-password=super-secret"),
      idempotencyKey: "idem-1",
      spaceId: "space-1",
      spaceName: "Ops Room",
    });

    expect(report).toMatchObject({
      eventName: "[core.openmeld.space.outbox.read_ledger_status_failed]",
      fields: {
        idempotencyKey: "idem-1",
        spaceId: "space-1",
        spaceName: "Ops Room",
      },
      finding: {
        reasonCode: "outbox.read_ledger_status_failed",
        summaryKey: "core.outbox.read_ledger_status_failed",
        humanContext: {
          idempotencyKey: "idem-1",
          spaceId: "space-1",
          spaceName: "Ops Room",
        },
      },
    });

    expect(report.fields.error).toContain("<redacted>");
    expect(report.fields.error).not.toContain("super-secret");
    expect(report.finding.humanContext?.error).toBe(report.fields.error);
  });
});
