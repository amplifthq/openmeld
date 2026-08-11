const ANONYMOUS_FEEDBACK_SUBMIT_ROUTE_PATTERN =
  /^\/v1\/feedback\/inboxes\/([^/]+)\/issues$/u;

export const FEEDBACK_SUBMIT_ROUTE =
  "/v1/feedback/inboxes/:inboxKey/issues" as const;

export type AnonymousFeedbackSubmitRoute = {
  inboxKey: string;
};

export function parseAnonymousFeedbackSubmitRoute(
  request: Request
): AnonymousFeedbackSubmitRoute | null {
  if (request.method.toUpperCase() !== "POST") {
    return null;
  }

  try {
    const match = ANONYMOUS_FEEDBACK_SUBMIT_ROUTE_PATTERN.exec(
      new URL(request.url).pathname
    );
    if (!match?.[1]) {
      return null;
    }
    const inboxKey = decodeURIComponent(match[1]);
    return inboxKey.length > 0 && !inboxKey.includes("/") ? { inboxKey } : null;
  } catch {
    return null;
  }
}
