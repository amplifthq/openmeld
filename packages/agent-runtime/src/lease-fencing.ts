export type LeaseArbitrationCurrent = {
  daemonSessionId: string;
  deviceId: string;
  lane: string;
  leaseEpoch: number;
};

export type LeaseArbitrationCandidate = {
  daemonSessionId: string;
  deviceId: string;
  lane: string;
  takeover?: boolean;
};

export type LeaseArbitrationDecision =
  | {
      accepted: true;
      nextLeaseEpoch: number;
      reason:
        | "new_session"
        | "same_session"
        | "same_device_reconnect"
        | "takeover";
    }
  | {
      accepted: false;
      reason: "conflict";
    };

export const resolveLeaseArbitration = (input: {
  current: LeaseArbitrationCurrent | null;
  candidate: LeaseArbitrationCandidate;
}): LeaseArbitrationDecision => {
  if (!input.current) {
    return {
      accepted: true,
      nextLeaseEpoch: 1,
      reason: "new_session",
    };
  }

  if (input.current.daemonSessionId === input.candidate.daemonSessionId) {
    return {
      accepted: true,
      nextLeaseEpoch: input.current.leaseEpoch,
      reason: "same_session",
    };
  }

  if (
    input.current.deviceId === input.candidate.deviceId &&
    input.current.lane === input.candidate.lane
  ) {
    return {
      accepted: true,
      nextLeaseEpoch: input.current.leaseEpoch + 1,
      reason: "same_device_reconnect",
    };
  }

  if (input.candidate.takeover === true) {
    return {
      accepted: true,
      nextLeaseEpoch: input.current.leaseEpoch + 1,
      reason: "takeover",
    };
  }

  return {
    accepted: false,
    reason: "conflict",
  };
};

export const isLeaseMatch = (input: {
  expectedDaemonSessionId: string;
  expectedLeaseEpoch: number;
  actualDaemonSessionId: string;
  actualLeaseEpoch: number;
}): boolean => {
  return (
    input.expectedDaemonSessionId === input.actualDaemonSessionId &&
    input.expectedLeaseEpoch === input.actualLeaseEpoch
  );
};
