// Delta detection for session readiness re-registrations.
//
// A daemon re-registers its full catalog on the same socket every time any
// route changes (nudge-triggered catalog syncs, periodic syncs). Re-publishing
// a readiness invalidation for every profile the session carries on each of
// those re-registrations is what turned one binding write into an
// account-wide broadcast storm. On a same-socket re-register the readiness
// verdict can only change for profiles whose registration facts changed, so
// the invalidation narrows to the component-level diff below. A new socket
// (connect/reconnect/replace) keeps the full fan-out: every carried profile
// genuinely flipped between offline and online.
//
// Fail-closed: skipped and rejected entries diff on profileId + reason, so a
// verdict-affecting reason change re-broadcasts even when the membership is
// unchanged, and the periodic route reconciliation remains the backstop.

export type SessionReadinessComponentSnapshot = {
  leaseProfileIds: readonly string[];
  reportIncludedProfileIds: readonly string[];
  reportSkippedKeys: readonly string[];
  rejectedKeys: readonly string[];
};

type SessionReadinessComponentsSource = {
  localWakeRouteReport: {
    includedProfileIds: readonly string[];
    skippedProfiles: readonly {
      profileId: string;
      skipReason: string;
    }[];
  } | null;
  profileIds: ReadonlySet<string>;
  rejectedProfileRegistrationsByProfileId: ReadonlyMap<
    string,
    { profileId: string; reasonCode: string }
  >;
};

const COMPONENT_KEY_SEPARATOR = "\0";

export function snapshotSessionReadinessComponents(
  session: SessionReadinessComponentsSource | null | undefined
): SessionReadinessComponentSnapshot {
  if (!session) {
    return {
      leaseProfileIds: [],
      reportIncludedProfileIds: [],
      reportSkippedKeys: [],
      rejectedKeys: [],
    };
  }
  return {
    leaseProfileIds: [...session.profileIds],
    reportIncludedProfileIds: [
      ...(session.localWakeRouteReport?.includedProfileIds ?? []),
    ],
    reportSkippedKeys: (
      session.localWakeRouteReport?.skippedProfiles ?? []
    ).map(
      (profile) =>
        `${profile.profileId}${COMPONENT_KEY_SEPARATOR}${profile.skipReason}`
    ),
    rejectedKeys: [
      ...session.rejectedProfileRegistrationsByProfileId.values(),
    ].map(
      (profile) =>
        `${profile.profileId}${COMPONENT_KEY_SEPARATOR}${profile.reasonCode}`
    ),
  };
}

export function diffSessionReadinessComponents(
  before: SessionReadinessComponentSnapshot,
  after: SessionReadinessComponentSnapshot
): string[] {
  const changedProfileIds = new Set<string>([
    ...symmetricDifference(before.leaseProfileIds, after.leaseProfileIds),
    ...symmetricDifference(
      before.reportIncludedProfileIds,
      after.reportIncludedProfileIds
    ),
    ...symmetricDifference(
      before.reportSkippedKeys,
      after.reportSkippedKeys
    ).map(extractProfileIdFromComponentKey),
    ...symmetricDifference(before.rejectedKeys, after.rejectedKeys).map(
      extractProfileIdFromComponentKey
    ),
  ]);
  changedProfileIds.delete("");
  return [...changedProfileIds];
}

function symmetricDifference(
  left: readonly string[],
  right: readonly string[]
): string[] {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const difference: string[] = [];
  for (const value of leftSet) {
    if (!rightSet.has(value)) {
      difference.push(value);
    }
  }
  for (const value of rightSet) {
    if (!leftSet.has(value)) {
      difference.push(value);
    }
  }
  return difference;
}

function extractProfileIdFromComponentKey(key: string): string {
  const separatorIndex = key.indexOf(COMPONENT_KEY_SEPARATOR);
  return separatorIndex === -1 ? key : key.slice(0, separatorIndex);
}
