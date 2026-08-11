import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { eq } from "drizzle-orm";
import type { createD1Db } from "../db";
import { openMeldWaitlistEmails } from "../db/waitlist-email.schema";

export type WaitlistEmailRecord = InferSelectModel<
  typeof openMeldWaitlistEmails
>;

type NewWaitlistEmailRecord = InferInsertModel<typeof openMeldWaitlistEmails>;

export type WaitlistRepository = {
  findByEmail: (email: string) => Promise<WaitlistEmailRecord | null>;
  insertEmail: (email: string) => Promise<boolean>;
};

type WaitlistDatabase = ReturnType<typeof createD1Db>;

export function createDrizzleWaitlistRepository(
  db: WaitlistDatabase
): WaitlistRepository {
  return {
    async findByEmail(email) {
      const rows = await db
        .select()
        .from(openMeldWaitlistEmails)
        .where(eq(openMeldWaitlistEmails.email, email))
        .limit(1);

      return rows[0] ?? null;
    },
    async insertEmail(email) {
      const value: NewWaitlistEmailRecord = {
        email,
        createdAt: new Date(),
      };
      const rows = await db
        .insert(openMeldWaitlistEmails)
        .values(value)
        .onConflictDoNothing({ target: openMeldWaitlistEmails.email })
        .returning({ email: openMeldWaitlistEmails.email });

      return rows.length > 0;
    },
  };
}
