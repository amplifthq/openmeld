import { describe, expect, it } from "vitest";
import { resolveProjectIssueAction } from "../src/projects/project-issue-action-routing";
import type { ProjectIssueRoutingCandidate } from "../src/projects/project-repository";

const destination = {
  provider: "linear" as const,
  teamId: "a86813e7-c458-4af2-8cfa-73a796d81201",
  projectId: "ef7c6509-3077-4d49-999e-0ee1c41eaef1",
};
const project: ProjectIssueRoutingCandidate = {
  id: "project-payments",
  name: "Payments",
  slug: "payments",
  repositoryUrl: "https://github.com/amplifthq/payments",
  routing: {
    projectId: "project-payments",
    destination,
    revision: 3,
    updatedAtMs: 42,
    updatedByUserId: "owner",
  },
};
const github = {
  provider: "github" as const,
  owner: "amplifthq",
  repo: "payments",
};

describe("Project issue action routing", () => {
  it("uses only a verified Task Project association for the exact default", () => {
    expect(
      resolveProjectIssueAction({
        projects: [project],
        taskProjectIds: [project.id],
        proposedDestination: destination,
      })
    ).toMatchObject({
      basis: "project_default",
      projectId: project.id,
      projectRevision: 3,
    });
    expect(
      resolveProjectIssueAction({
        projects: [project],
        taskProjectIds: [],
        proposedDestination: destination,
      })
    ).toMatchObject({ basis: "confirmation_required", projectId: null });
  });
  it.each([
    github,
    { ...destination, projectId: undefined },
    { ...destination, projectId: "8220185c-3f49-4a8f-8d02-96b190fdd205" },
  ])("requires exact-target confirmation for an override, including a different or omitted Linear project", (proposedDestination) => {
    expect(
      resolveProjectIssueAction({
        projects: [project],
        taskProjectIds: [project.id],
        proposedDestination,
      })
    ).toMatchObject({
      basis: "confirmation_required",
      destination: proposedDestination,
      projectRevision: null,
    });
  });
  it("cannot promote negated, conditional, quoted or provider-only text into confirmation", () => {
    for (const requestText of [
      "Payments：放到 Linear 里跟踪",
      "Payments: Do not, under any circumstances, create a GitHub issue in amplifthq/payments.",
      "Payments: If we leave Linear next month, create a GitHub issue.",
      "> Create a GitHub issue in https://github.com/amplifthq/payments",
      `Payments: create a Linear issue in team ${destination.teamId}`,
    ]) {
      const proposed = {
        projects: [project],
        taskProjectIds: [project.id],
        proposedDestination: github,
        requestText,
        requesterCanOverride: true,
      };
      expect(resolveProjectIssueAction(proposed).basis).toBe(
        "confirmation_required"
      );
    }
  });
  it("does not choose a default from ambiguous, missing or inactive Project scope", () => {
    for (const taskProjectIds of [
      [project.id, "project-other"],
      ["project-removed"],
      [],
    ]) {
      expect(
        resolveProjectIssueAction({
          projects: [project],
          taskProjectIds,
          proposedDestination: destination,
        }).basis
      ).toBe("confirmation_required");
    }
  });
});
