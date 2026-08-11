export function buildFeedbackIssueSubmissionPath(inboxKey: string): string {
  return `/v1/feedback/inboxes/${encodeURIComponent(inboxKey)}/issues`;
}

export function buildCurrentOrganizationFeedbackReportingPolicyPath(): string {
  return "/v1/organizations/current/feedback-reporting-policy";
}
