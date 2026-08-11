import { describe, expect, it, vi } from "vitest";
import { createFeedbackApi, createOpenMeldApiClient } from "../src";

describe("api-client Feedback API", () => {
  it("submits a Feedback Issue through the public inbox route", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          ok: true,
          issueId: "feedback_issue_f4980202-efe0-467c-bcc3-92760fce0c69",
        })
      )
    );
    const api = createFeedbackApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.submitFeedbackIssue({
      inboxKey: "feedback/key",
      request: {
        category: "experience",
        summary: "The setup handoff was unclear.",
        details: "The terminal did not explain the next action.",
        submitterKind: "human",
        contactEmail: "mira@example.com",
        clientContext: {
          clientKind: "cli",
          clientVersion: "0.2.23",
          os: "darwin",
        },
      },
    });

    expect(result).toEqual({
      ok: true,
      issueId: "feedback_issue_f4980202-efe0-467c-bcc3-92760fce0c69",
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "feedback.issue.submit",
        url: "https://gateway.openmeld.invalid/v1/feedback/inboxes/feedback%2Fkey/issues",
        init: expect.objectContaining({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            category: "experience",
            summary: "The setup handoff was unclear.",
            details: "The terminal did not explain the next action.",
            submitterKind: "human",
            contactEmail: "mira@example.com",
            clientContext: {
              clientKind: "cli",
              clientVersion: "0.2.23",
              os: "darwin",
            },
          }),
        }),
      })
    );
  });

  it("reads the current Organization feedback reporting policy", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          organizationId: "org-1",
          reportingEnabled: true,
          updatedByUserId: null,
        })
      )
    );
    const api = createFeedbackApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.readCurrentOrganizationFeedbackReportingPolicy()
    ).resolves.toEqual({
      organizationId: "org-1",
      reportingEnabled: true,
      updatedByUserId: null,
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({ method: "GET" }),
        operation: "feedback.reporting_policy.read",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/feedback-reporting-policy",
      })
    );
  });

  it("sets the current Organization feedback reporting policy", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          organizationId: "org-1",
          reportingEnabled: false,
          updatedByUserId: "owner-1",
        })
      )
    );
    const api = createFeedbackApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.setCurrentOrganizationFeedbackReportingPolicy({
        reportingEnabled: false,
      })
    ).resolves.toMatchObject({ reportingEnabled: false });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({ reportingEnabled: false }),
          headers: expect.objectContaining({
            "content-type": "application/json",
          }),
          method: "PUT",
        }),
        operation: "feedback.reporting_policy.write",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/feedback-reporting-policy",
      })
    );
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
