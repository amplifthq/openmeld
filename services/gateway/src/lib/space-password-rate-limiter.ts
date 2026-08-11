export const SPACE_PASSWORD_RATE_LIMIT = {
  limit: 10,
  periodSeconds: 60,
} as const;

export type SpacePasswordRateLimiter = {
  check(input: { ipAddress: string; spaceId: string }): Promise<boolean>;
};

export function createCloudflareSpacePasswordRateLimiter(
  binding: RateLimit
): SpacePasswordRateLimiter {
  if (!binding?.limit) {
    throw new Error("Space password rate limit binding is unavailable");
  }

  return {
    async check({ ipAddress, spaceId }) {
      const outcome = await binding.limit({
        key: `pw:${ipAddress}:${spaceId}`,
      });
      return outcome.success;
    },
  };
}
