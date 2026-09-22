import { openMeldWaitlistEmails } from "@openmeld/db/auth";
import {
  eq,
  type InferInsertModel,
  type InferSelectModel,
} from "@openmeld/db/query";
import { describe, expect, expectTypeOf, it } from "vitest";

describe("shared DB query boundary", () => {
  it("keeps Auth predicates and inferred records in the canonical table's Drizzle identity", () => {
    // Equal vendor versions can still resolve to distinct pnpm peer instances.
    // Check both the runtime SQL class and the nominal TypeScript declarations.
    const predicate = eq(openMeldWaitlistEmails.email, "reader@example.test");
    expect(predicate.constructor).toBe(
      openMeldWaitlistEmails.getSQL().constructor
    );
    expectTypeOf<typeof predicate>().toEqualTypeOf<
      ReturnType<typeof openMeldWaitlistEmails.getSQL>
    >();
    expectTypeOf<
      InferInsertModel<typeof openMeldWaitlistEmails>
    >().toEqualTypeOf<typeof openMeldWaitlistEmails.$inferInsert>();
    expectTypeOf<
      InferSelectModel<typeof openMeldWaitlistEmails>
    >().toEqualTypeOf<typeof openMeldWaitlistEmails.$inferSelect>();
  });
});
