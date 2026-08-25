import * as z from "zod/v4";

export const DAEMON_ROUTE_OBSERVATION_STATUS_VALUES = [
  "online",
  "offline",
  "unavailable",
] as const;

export const DAEMON_ROUTE_OBSERVATION_UNAVAILABLE_REASON_CODE_VALUES = [
  "lookup_failed",
  "not_requested",
  "profile_not_agent",
  "profile_not_selected",
  "server_unsupported",
] as const;

export const DAEMON_ROUTE_OBSERVATION_REASON_CODE_VALUES = [
  "online",
  "route.not_registered",
  ...DAEMON_ROUTE_OBSERVATION_UNAVAILABLE_REASON_CODE_VALUES,
] as const;

export const daemonRouteObservationStatusSchema = z.enum(
  DAEMON_ROUTE_OBSERVATION_STATUS_VALUES
);

export const daemonRouteObservationUnavailableReasonCodeSchema = z.enum(
  DAEMON_ROUTE_OBSERVATION_UNAVAILABLE_REASON_CODE_VALUES
);

export const daemonRouteObservationReasonCodeSchema = z.enum(
  DAEMON_ROUTE_OBSERVATION_REASON_CODE_VALUES
);

type DaemonRouteObservationStatus =
  (typeof DAEMON_ROUTE_OBSERVATION_STATUS_VALUES)[number];
type DaemonRouteObservationUnavailableReasonCode =
  (typeof DAEMON_ROUTE_OBSERVATION_UNAVAILABLE_REASON_CODE_VALUES)[number];

const CANONICAL_UNAVAILABLE_REASON_CODE_SET = new Set<string>(
  DAEMON_ROUTE_OBSERVATION_UNAVAILABLE_REASON_CODE_VALUES
);

function isCanonicalUnavailableReasonCode(
  value: string | null | undefined
): value is DaemonRouteObservationUnavailableReasonCode {
  return value !== null && value !== undefined
    ? CANONICAL_UNAVAILABLE_REASON_CODE_SET.has(value)
    : false;
}

export function createDaemonRouteObservationSummary(input: {
  observedAt: string;
  reasonCode?: string | null;
  status: DaemonRouteObservationStatus;
}): z.infer<typeof daemonRouteObservationSummarySchema> {
  if (input.status === "online") {
    return {
      observedAt: input.observedAt,
      reasonCode: "online",
      status: "online",
    };
  }

  if (input.status === "offline") {
    return {
      observedAt: input.observedAt,
      reasonCode: "route.not_registered",
      status: "offline",
    };
  }

  return {
    observedAt: input.observedAt,
    reasonCode: isCanonicalUnavailableReasonCode(input.reasonCode)
      ? input.reasonCode
      : "lookup_failed",
    status: "unavailable",
  };
}

export const daemonRouteObservationSummarySchema = z
  .strictObject({
    observedAt: z.iso.datetime({ offset: true }),
    reasonCode: daemonRouteObservationReasonCodeSchema,
    status: daemonRouteObservationStatusSchema,
  })
  .superRefine((value, ctx) => {
    if (value.status === "online" && value.reasonCode !== "online") {
      ctx.addIssue({
        code: "custom",
        message: "online route observation must use online reasonCode",
        path: ["reasonCode"],
      });
    }
    if (
      value.status === "offline" &&
      value.reasonCode !== "route.not_registered"
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "offline route observation must normalize to route.not_registered",
        path: ["reasonCode"],
      });
    }
    if (
      value.status === "unavailable" &&
      (value.reasonCode === "online" ||
        value.reasonCode === "route.not_registered")
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "unavailable route observation must use an unavailable reasonCode",
        path: ["reasonCode"],
      });
    }
  });
