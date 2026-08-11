export const springs = {
  fast: {
    type: "spring" as const,
    duration: 0.08,
    bounce: 0,
  },
  moderate: {
    type: "spring" as const,
    duration: 0.16,
    bounce: 0.15,
  },
  slow: {
    type: "spring" as const,
    duration: 0.24,
    bounce: 0.15,
  },
} as const;
