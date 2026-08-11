export type HealthFindingSeverity = "warn" | "error";

export type HealthHumanContext = Record<
  string,
  string | number | boolean | null
>;

export type HealthFindingShape = {
  reasonCode: string;
  severity: HealthFindingSeverity;
  summaryKey: string;
  humanContext: HealthHumanContext | null;
};

export type HealthLogField =
  | string
  | number
  | boolean
  | null
  | readonly (string | number | boolean | null)[];

export type HealthView<TFinding extends HealthFindingShape> = {
  finding: {
    reasonCode: TFinding["reasonCode"];
    severity: TFinding["severity"];
    summaryKey: TFinding["summaryKey"];
  };
  human: TFinding["humanContext"];
};

type HealthLogSink = {
  error?: (message?: unknown, ...optionalParams: unknown[]) => void;
  warn?: (message?: unknown, ...optionalParams: unknown[]) => void;
};

const normalizeExtraFields = (
  fields: Record<string, HealthLogField | undefined> | null | undefined
): Record<string, HealthLogField> => {
  if (!fields) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(fields).filter(
      (entry): entry is [string, HealthLogField] => entry[1] !== undefined
    )
  );
};

export const buildHealthView = <TFinding extends HealthFindingShape>(input: {
  finding: TFinding;
}): HealthView<TFinding> => ({
  finding: {
    reasonCode: input.finding.reasonCode,
    severity: input.finding.severity,
    summaryKey: input.finding.summaryKey,
  },
  human: input.finding.humanContext,
});

export const emitHealthFinding = <TFinding extends HealthFindingShape>(input: {
  eventName: string;
  fields?: Record<string, HealthLogField | undefined> | null;
  finding: TFinding;
  logSink?: HealthLogSink | null;
}): void => {
  const logSink =
    input.logSink ?? (globalThis as { console?: HealthLogSink }).console;
  const payload = {
    ...buildHealthView({
      finding: input.finding,
    }),
    ...normalizeExtraFields(input.fields),
  };
  if (input.finding.severity === "error") {
    logSink?.error?.(input.eventName, payload);
    return;
  }
  logSink?.warn?.(input.eventName, payload);
};
