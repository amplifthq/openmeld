import type {
  AuthorityOpenMeldServiceRuntimeId,
  RuntimeLookupInput,
} from "./runtime-id-contract";

export type RuntimeRegistryContractRegistrationStatus = "registered" | "reused";

export type RuntimeRegistryContractRegistrationInput = {
  lookupInput: RuntimeLookupInput;
  openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
};

export type RuntimeRegistryContractRegistrationResult = {
  status: RuntimeRegistryContractRegistrationStatus;
  openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
};

export type RuntimeAgentControllerReportStatus =
  | "ready"
  | "disabled"
  | "unavailable"
  | "unknown";

export type RuntimeAgentControllerReport = {
  agentControllerRef: string;
  observedAt: string;
  expiresAt: string;
  status: RuntimeAgentControllerReportStatus;
  reasonCodes?: readonly string[];
};

export type RuntimeAgentControllerReportAcceptanceStatus =
  | "accepted"
  | "rejected";

export type RuntimeAgentControllerReportAcceptanceInput = {
  lookupInput: RuntimeLookupInput;
  now: Date | string;
  report: RuntimeAgentControllerReport;
};

export type RuntimeAgentControllerReportAcceptanceResult = {
  status: RuntimeAgentControllerReportAcceptanceStatus;
  reasonCodes: readonly string[];
  currentAgentControllerReport: RuntimeAgentControllerReport | undefined;
};

export type RuntimeRegistryContractRecord = {
  lookupInput: RuntimeLookupInput;
  openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
  currentAgentControllerReport: RuntimeAgentControllerReport | undefined;
};

export type RuntimeRegistryContractProjection = {
  openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
  currentAgentControllerReport: RuntimeAgentControllerReport | undefined;
};

export type InMemoryRuntimeRegistryContractFixture = {
  registerRuntime: (
    input: RuntimeRegistryContractRegistrationInput
  ) => RuntimeRegistryContractRegistrationResult;
  acceptAgentControllerReport: (
    input: RuntimeAgentControllerReportAcceptanceInput
  ) => RuntimeAgentControllerReportAcceptanceResult;
  readRuntime: (
    lookupInput: RuntimeLookupInput
  ) => RuntimeRegistryContractRecord | undefined;
  readRuntimeProjection: (
    lookupInput: RuntimeLookupInput
  ) => RuntimeRegistryContractProjection | undefined;
};

const createCanonicalRuntimeLookupKey = (
  lookupInput: RuntimeLookupInput
): string => {
  return JSON.stringify({
    ownerKind: lookupInput.owner.kind,
    ownerId: lookupInput.owner.id,
    deviceId: lookupInput.deviceId,
    lane: lookupInput.lane,
  });
};

const getTimestamp = (value: Date | string, fieldName: string): number => {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);

  if (Number.isNaN(timestamp)) {
    throw new Error(
      `runtime.agent_controller_report_time_invalid: ${fieldName} is invalid`
    );
  }

  return timestamp;
};

const isAgentControllerReportStale = ({
  now,
  report,
}: RuntimeAgentControllerReportAcceptanceInput): boolean => {
  return (
    getTimestamp(report.expiresAt, "expiresAt") <= getTimestamp(now, "now")
  );
};

const isAgentControllerReportOutOfOrder = ({
  currentAgentControllerReport,
  nextAgentControllerReport,
}: {
  currentAgentControllerReport: RuntimeAgentControllerReport | undefined;
  nextAgentControllerReport: RuntimeAgentControllerReport;
}): boolean => {
  if (!currentAgentControllerReport) {
    return false;
  }

  return (
    getTimestamp(nextAgentControllerReport.observedAt, "observedAt") <
    getTimestamp(currentAgentControllerReport.observedAt, "currentObservedAt")
  );
};

const createRuntimeRegistryContractProjection = (
  record: RuntimeRegistryContractRecord
): RuntimeRegistryContractProjection => {
  return {
    openMeldServiceRuntimeId: record.openMeldServiceRuntimeId,
    currentAgentControllerReport: record.currentAgentControllerReport,
  };
};

// Pure contract fixture only. It has no IO and must not become a production registry fallback.
export const createInMemoryRuntimeRegistryContractFixture =
  (): InMemoryRuntimeRegistryContractFixture => {
    const recordsByLookupKey = new Map<string, RuntimeRegistryContractRecord>();

    return {
      acceptAgentControllerReport: ({ lookupInput, now, report }) => {
        const lookupKey = createCanonicalRuntimeLookupKey(lookupInput);
        const existingRecord = recordsByLookupKey.get(lookupKey);

        if (!existingRecord) {
          throw new Error(
            "runtime.registry_record_missing: cannot accept agent controller report for unregistered runtime"
          );
        }

        if (isAgentControllerReportStale({ lookupInput, now, report })) {
          return {
            status: "rejected",
            reasonCodes: ["runtime.agent_controller_report_stale"],
            currentAgentControllerReport:
              existingRecord.currentAgentControllerReport,
          };
        }

        if (
          isAgentControllerReportOutOfOrder({
            currentAgentControllerReport:
              existingRecord.currentAgentControllerReport,
            nextAgentControllerReport: report,
          })
        ) {
          return {
            status: "rejected",
            reasonCodes: ["runtime.agent_controller_report_out_of_order"],
            currentAgentControllerReport:
              existingRecord.currentAgentControllerReport,
          };
        }

        existingRecord.currentAgentControllerReport = report;

        return {
          status: "accepted",
          reasonCodes: [],
          currentAgentControllerReport:
            existingRecord.currentAgentControllerReport,
        };
      },
      registerRuntime: ({ lookupInput, openMeldServiceRuntimeId }) => {
        const lookupKey = createCanonicalRuntimeLookupKey(lookupInput);
        const existingRecord = recordsByLookupKey.get(lookupKey);

        if (existingRecord) {
          return {
            status: "reused",
            openMeldServiceRuntimeId: existingRecord.openMeldServiceRuntimeId,
          };
        }

        recordsByLookupKey.set(lookupKey, {
          lookupInput,
          openMeldServiceRuntimeId,
          currentAgentControllerReport: undefined,
        });

        return {
          status: "registered",
          openMeldServiceRuntimeId,
        };
      },
      readRuntime: (lookupInput) => {
        return recordsByLookupKey.get(
          createCanonicalRuntimeLookupKey(lookupInput)
        );
      },
      readRuntimeProjection: (lookupInput) => {
        const record = recordsByLookupKey.get(
          createCanonicalRuntimeLookupKey(lookupInput)
        );

        return record
          ? createRuntimeRegistryContractProjection(record)
          : undefined;
      },
    };
  };
