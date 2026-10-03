import { text } from "drizzle-orm/pg-core";
import {
  applicationTable,
  currentTimestampMilliseconds,
} from "../postgresql/schema.ts";
import { epochMilliseconds } from "../postgresql/schema-types.ts";

export const openMeldWaitlistEmails = applicationTable(
  "openmeld_waitlist_emails",
  {
    email: text("email").primaryKey(),
    createdAt: epochMilliseconds("created_at")
      .default(currentTimestampMilliseconds)
      .notNull(),
  }
);
