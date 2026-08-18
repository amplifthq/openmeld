import type { BetterAuthPlugin, User } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import normalizeEmail from "validator/lib/normalizeEmail.js";

const EMAIL_VALIDATION_PATHS = new Set([
  "/sign-up/email",
  "/email-otp/verify-email",
  "/sign-in/email-otp",
  "/sign-in/magic-link",
  "/sign-in/email",
  "/forget-password/email-otp",
  "/email-otp/request-password-reset",
  "/email-otp/reset-password",
  "/email-otp/create-verification-otp",
  "/email-otp/get-verification-otp",
  "/email-otp/send-verification-otp",
  "/forget-password",
  "/request-password-reset",
  "/send-verification-email",
  "/change-email",
]);

type EmailValidator = (email: string) => boolean | Promise<boolean>;
type UserWrite = Partial<User> & { phoneNumber?: string };
type NormalizedUserWrite = UserWrite & {
  normalizedEmail?: string;
};

export function normalizeOpenMeldUserEmail(
  user: UserWrite
): Promise<false | { data: NormalizedUserWrite }> {
  if (!(user.email && !user.phoneNumber)) {
    return Promise.resolve({ data: user });
  }

  const normalizedEmail = normalizeEmail(user.email);
  return Promise.resolve(
    normalizedEmail
      ? {
          data: { ...user, normalizedEmail },
        }
      : false
  );
}

export function createOpenMeldEmailIdentityPlugin(input: {
  validator: EmailValidator;
}): BetterAuthPlugin {
  return {
    id: "openmeld-email-identity",
    init: () => ({
      options: {
        databaseHooks: {
          user: {
            create: { before: normalizeOpenMeldUserEmail },
            update: { before: normalizeOpenMeldUserEmail },
          },
        },
      },
    }),
    schema: {
      user: {
        fields: {
          normalizedEmail: {
            input: false,
            required: false,
            returned: false,
            type: "string",
            unique: true,
          },
        },
      },
    },
    hooks: {
      before: [
        {
          matcher: (context) =>
            typeof context.path === "string" &&
            EMAIL_VALIDATION_PATHS.has(context.path),
          handler: createAuthMiddleware(async (context) => {
            const email =
              context.path === "/change-email"
                ? context.body?.newEmail
                : (context.body?.email ?? context.query?.email);
            if (typeof email !== "string") {
              return;
            }
            if (!(await input.validator(email))) {
              throw new APIError("BAD_REQUEST", {
                message: "Invalid email",
              });
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
