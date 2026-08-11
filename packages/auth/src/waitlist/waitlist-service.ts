import type { WaitlistRepository } from "./waitlist-repository";

export type JoinWaitlistInput = {
  email: string;
};

export type JoinWaitlistStatus = "created" | "already_exists";

export type JoinWaitlistResult = {
  email: string;
  status: JoinWaitlistStatus;
};

export function normalizeWaitlistEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createWaitlistService(repository: WaitlistRepository) {
  return {
    async joinWaitlist(input: JoinWaitlistInput): Promise<JoinWaitlistResult> {
      const email = normalizeWaitlistEmail(input.email);
      const existing = await repository.findByEmail(email);
      if (existing) {
        return {
          email,
          status: "already_exists",
        };
      }

      const inserted = await repository.insertEmail(email);
      return {
        email,
        status: inserted ? "created" : "already_exists",
      };
    },
  };
}
