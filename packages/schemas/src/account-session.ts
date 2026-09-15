import * as z from "zod/v4";

export const ACCOUNT_SESSION_PATH = "/v1/account/session" as const;

// A display projection, not a credential or a session-management record.
export const accountSessionSchema = z.strictObject({
  user: z.strictObject({
    id: z.string().min(1),
    email: z.string(),
    name: z.string(),
    image: z.string().nullable(),
    emailVerified: z.boolean(),
    createdAt: z.iso.datetime(),
  }),
  session: z.strictObject({ id: z.string().min(1) }),
});

export type AccountSession = z.infer<typeof accountSessionSchema>;
