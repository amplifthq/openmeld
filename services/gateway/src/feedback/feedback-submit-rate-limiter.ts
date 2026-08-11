export const FEEDBACK_SUBMIT_RATE_LIMITS = {
  ip: { limit: 10, periodSeconds: 60 },
  inbox: { limit: 120, periodSeconds: 60 },
} as const;

export type FeedbackSubmitRateLimitDimension = "ip" | "inbox";

export type FeedbackSubmitRateLimitResult =
  | { allowed: true; rejectedDimension: null }
  | {
      allowed: false;
      rejectedDimension: FeedbackSubmitRateLimitDimension;
    };

export type FeedbackSubmitRateLimiter = {
  check(input: {
    ipAddress: string;
    inboxKey: string;
  }): Promise<FeedbackSubmitRateLimitResult>;
};

export function createCloudflareFeedbackSubmitRateLimiter(input: {
  ip: RateLimit;
  inbox: RateLimit;
}): FeedbackSubmitRateLimiter {
  if (!(input.ip?.limit && input.inbox?.limit)) {
    throw new Error("Feedback rate limit binding is unavailable");
  }

  return {
    async check({ ipAddress, inboxKey }) {
      const ipOutcome = await input.ip.limit({ key: `ip:${ipAddress}` });
      if (!ipOutcome.success) {
        return { allowed: false, rejectedDimension: "ip" };
      }

      const inboxOutcome = await input.inbox.limit({
        key: `inbox:${inboxKey}`,
      });
      if (!inboxOutcome.success) {
        return { allowed: false, rejectedDimension: "inbox" };
      }

      return { allowed: true, rejectedDimension: null };
    },
  };
}
