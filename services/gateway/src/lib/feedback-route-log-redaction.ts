import { FEEDBACK_SUBMIT_ROUTE } from "./anonymous-feedback-submit-route";

const FEEDBACK_SUBMIT_LOG_ROUTE_PATTERN =
  /^\/v1\/feedback\/inboxes\/[^/]+\/issues$/u;
const FEEDBACK_INBOX_LOG_ROUTE_PATTERN =
  /^\/v1\/feedback\/inboxes\/[^/]+(?:\/.*)?$/u;

export const FEEDBACK_INBOX_LOG_ROUTE =
  "/v1/feedback/inboxes/:inboxKey/*" as const;

export function redactFeedbackRouteForLogging(request: Request): string | null {
  try {
    const pathname = new URL(request.url).pathname;
    if (!FEEDBACK_INBOX_LOG_ROUTE_PATTERN.test(pathname)) {
      return null;
    }
    return FEEDBACK_SUBMIT_LOG_ROUTE_PATTERN.test(pathname)
      ? FEEDBACK_SUBMIT_ROUTE
      : FEEDBACK_INBOX_LOG_ROUTE;
  } catch {
    return null;
  }
}
