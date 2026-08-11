import {
  createFeedbackApi,
  toStructuredApiClientFailure,
} from "@openmeld/api-client";
import {
  type SubmitFeedbackIssueRequest,
  submitFeedbackIssueRequestSchema,
} from "@openmeld/schemas";
import { resolveBaseUrl } from "../config/base-url";
import { resolveFeedbackInboxKey } from "../config/feedback";
import { emitCliErrorJson } from "../runtime/cli-error-json";
import { emitCliJsonEnvelope } from "../runtime/cli-json-output";
import { getCliVersionInfo } from "../runtime/cli-version";
import { resolveRuntimeContext } from "../runtime/context";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import { outLine } from "../ui/io";

const MAX_SUMMARY_LENGTH = 200;
const TRUNCATED_SUMMARY_PREFIX_LENGTH = 197;
const MAX_DETAILS_LENGTH = 4000;
const FEEDBACK_CATEGORIES =
  submitFeedbackIssueRequestSchema.shape.category.options;
type FeedbackCategory = SubmitFeedbackIssueRequest["category"];
type FeedbackSubmitterKind = SubmitFeedbackIssueRequest["submitterKind"];

export type RunFeedbackInput = {
  message: string;
  category?: string;
  details?: string;
  email?: string;
  submitterKind?: string;
  includeContext?: boolean;
  inboxKey?: string;
  view?: string;
};

export class FeedbackCommandError extends Error {
  readonly code: string;
  readonly requestId: string | null;

  constructor(input: {
    code: string;
    message: string;
    requestId?: string | null;
  }) {
    super(input.message);
    this.name = "FeedbackCommandError";
    this.code = input.code;
    this.requestId = input.requestId ?? null;
  }
}

export async function runFeedback(input: RunFeedbackInput): Promise<void> {
  const runtime = await resolveRuntimeContext({ view: input.view });

  try {
    const category = resolveFeedbackCategory(input.category);
    const submitterKind = resolveFeedbackSubmitterKind({
      value: input.submitterKind,
      agentView: runtime.resolvedView === "agent",
    });
    const content = buildFeedbackContent({
      message: input.message,
      details: input.details,
    });
    const request = buildFeedbackRequest({
      category,
      content,
      email: input.email,
      includeContext: input.includeContext !== false,
      submitterKind,
    });
    const gatewayUrl = await resolveBaseUrl();
    let anonymous = true;
    const feedbackApi = createFeedbackApi(
      createCliApiClientFoundation(gatewayUrl, {
        onAuthHeadersResolved: (headers) => {
          anonymous = !hasAuthorizationHeader(headers);
        },
      })
    );
    const response = await feedbackApi.submitFeedbackIssue({
      inboxKey: resolveFeedbackInboxKey({ cliValue: input.inboxKey }),
      request,
    });

    if (runtime.resolvedView === "agent") {
      emitCliJsonEnvelope({
        schemaVersion: 1,
        type: "feedback_submitted",
        issueId: response.issueId,
        category,
        submitterKind,
        anonymous,
      });
      return;
    }

    outLine(
      `Feedback submitted — issue ID: ${response.issueId}. Thanks for helping us improve OpenMeld.`
    );
    outLine(
      `Category: ${category} · Submission: ${anonymous ? "anonymous" : "signed-in"}`
    );
    if (content.detailsTruncated) {
      outLine("Details were shortened to the 4,000-character limit.");
    }
  } catch (error) {
    const failure = toFeedbackCommandError(error);
    if (runtime.resolvedView === "agent") {
      emitCliErrorJson({
        code: failure.code,
        message: failure.message,
        requestId: failure.requestId,
      });
      process.exitCode = 1;
      return;
    }
    throw failure;
  }
}

function buildFeedbackContent(input: { message: string; details?: string }): {
  summary: string;
  details?: string;
  detailsTruncated: boolean;
} {
  if (input.message.trim().length === 0) {
    throw new FeedbackCommandError({
      code: "feedback.submit.invalid_input",
      message: "Feedback message must not be empty.",
    });
  }

  if (input.message.length <= MAX_SUMMARY_LENGTH) {
    return {
      summary: input.message,
      ...(input.details === undefined ? {} : { details: input.details }),
      detailsTruncated: false,
    };
  }

  const mergedDetails =
    input.details === undefined
      ? input.message
      : `${input.message}\n\n${input.details}`;
  const detailsTruncated = mergedDetails.length > MAX_DETAILS_LENGTH;
  return {
    summary: `${input.message.slice(0, TRUNCATED_SUMMARY_PREFIX_LENGTH)}...`,
    details: detailsTruncated
      ? mergedDetails.slice(0, MAX_DETAILS_LENGTH)
      : mergedDetails,
    detailsTruncated,
  };
}

function buildFeedbackRequest(input: {
  category: FeedbackCategory;
  content: ReturnType<typeof buildFeedbackContent>;
  email?: string;
  includeContext: boolean;
  submitterKind: FeedbackSubmitterKind;
}): SubmitFeedbackIssueRequest {
  const candidate = {
    category: input.category,
    summary: input.content.summary,
    ...(input.content.details === undefined
      ? {}
      : { details: input.content.details }),
    submitterKind: input.submitterKind,
    ...(input.email === undefined ? {} : { contactEmail: input.email }),
    ...(input.includeContext
      ? {
          clientContext: {
            clientKind: "cli" as const,
            clientVersion: getCliVersionInfo().version,
            os: process.platform,
          },
        }
      : {}),
  };
  const parsed = submitFeedbackIssueRequestSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new FeedbackCommandError({
      code: "feedback.submit.invalid_input",
      message:
        "OpenMeld could not submit this feedback because the input is invalid. Check the message, details, and email address, then try again.",
    });
  }
  return parsed.data;
}

function resolveFeedbackCategory(value: string | undefined): FeedbackCategory {
  const normalized = String(value ?? "experience")
    .trim()
    .toLowerCase();
  if (FEEDBACK_CATEGORIES.includes(normalized as FeedbackCategory)) {
    return normalized as FeedbackCategory;
  }
  throw new FeedbackCommandError({
    code: "feedback.submit.invalid_input",
    message: `--category must be one of: ${FEEDBACK_CATEGORIES.join(", ")}.`,
  });
}

function resolveFeedbackSubmitterKind(input: {
  value?: string;
  agentView: boolean;
}): "human" | "local_agent" {
  if (input.value === undefined) {
    return input.agentView ? "local_agent" : "human";
  }

  const normalized = input.value.trim().toLowerCase();
  if (normalized === "human" || normalized === "local_agent") {
    return normalized;
  }
  if (normalized === "center_agent") {
    throw new FeedbackCommandError({
      code: "feedback.submit.invalid_input",
      message:
        "--as accepts human or local_agent. center_agent is reserved for the Center Agent feedback flow.",
    });
  }
  throw new FeedbackCommandError({
    code: "feedback.submit.invalid_input",
    message: "--as must be one of: human, local_agent.",
  });
}

function hasAuthorizationHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers).some(
    (headerName) => headerName.toLowerCase() === "authorization"
  );
}

function toFeedbackCommandError(error: unknown): FeedbackCommandError {
  if (error instanceof FeedbackCommandError) {
    return error;
  }

  const failure = toStructuredApiClientFailure(error);
  const code = failure.code ?? "feedback.submit.failed";
  return new FeedbackCommandError({
    code,
    message: resolveFeedbackFailureMessage(code),
    requestId: failure.requestId,
  });
}

function resolveFeedbackFailureMessage(code: string): string {
  switch (code) {
    case "feedback.submit.inbox_not_found":
      return "This feedback inbox could not be found. Check the inbox key and try again.";
    case "feedback.submit.rate_limited":
      return "Too much feedback was submitted recently. Please wait a minute and try again.";
    case "feedback.submit.invalid_input":
      return "OpenMeld could not submit this feedback because the input is invalid. Check the message, details, and email address, then try again.";
    case "feedback.submit.disabled":
      return "This feedback inbox is not accepting submissions right now.";
    case "network.timeout":
      return "OpenMeld could not submit your feedback because the request timed out. Please try again.";
    case "network.request_failed":
      return "OpenMeld could not reach the feedback service. Check your connection and try again.";
    case "gateway.invalid_response":
      return "OpenMeld received an invalid feedback response. Please try again.";
    default:
      return "OpenMeld could not submit your feedback. Please try again.";
  }
}
