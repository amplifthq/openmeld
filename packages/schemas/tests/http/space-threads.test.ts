import { describe, expect, it } from "vitest";
import { postNormalMessageBodySchema } from "../../src/schemas/http/space-signals";
import {
  listSpaceThreadSignalsQuerySchema,
  postSpaceThreadSignalBodySchema,
} from "../../src/schemas/http/space-threads";

describe("message author read confirmation", () => {
  it("preserves explicit confirmation and leaves legacy sends unconfirmed", () => {
    const text = "The planning notes are ready.";
    expect(
      postNormalMessageBodySchema.parse({ text, meta: { authorHasRead: true } })
        .meta?.authorHasRead
    ).toBe(true);
    expect(
      postNormalMessageBodySchema.parse({ text }).meta?.authorHasRead
    ).toBeUndefined();
    const thread = {
      text,
      clientMessageId: "67510675-7b30-442a-8e3a-567729227666",
    };
    expect(
      postSpaceThreadSignalBodySchema.parse({ ...thread, authorHasRead: true })
        .authorHasRead
    ).toBe(true);
    expect(
      postSpaceThreadSignalBodySchema.parse(thread).authorHasRead
    ).toBeUndefined();
    expect(
      postNormalMessageBodySchema.safeParse({
        text,
        meta: { authorHasRead: "true" },
      }).success
    ).toBe(false);
    expect(
      postSpaceThreadSignalBodySchema.safeParse({
        ...thread,
        authorHasRead: "true",
      }).success
    ).toBe(false);
  });
});

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
