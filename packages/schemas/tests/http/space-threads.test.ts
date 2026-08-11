import { describe, expect, it } from "vitest";
import { listSpaceThreadSignalsQuerySchema } from "../../src/schemas/http/space-threads";

describe("listSpaceThreadSignalsQuerySchema", () => {
  it("accepts either an unbounded read or a complete bounded read", () => {
    expect(listSpaceThreadSignalsQuerySchema.parse({})).toEqual({});
    expect(
      listSpaceThreadSignalsQuerySchema.parse({
        afterSignalId: "  sig-observed  ",
        limit: "20",
      })
    ).toEqual({ afterSignalId: "sig-observed", limit: 20 });
  });

  it.each([
    { afterSignalId: "sig-observed" },
    { limit: "20" },
    { afterSignalId: "", limit: "20" },
    { afterSignalId: "sig-observed", limit: "0" },
    { afterSignalId: "sig-observed", limit: "101" },
    { afterSignalId: "sig-observed", limit: "2.5" },
  ])("rejects an incomplete or invalid bounded read: %j", (query) => {
    expect(listSpaceThreadSignalsQuerySchema.safeParse(query).success).toBe(
      false
    );
  });
});
