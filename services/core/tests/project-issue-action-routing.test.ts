import { describe, expect, it } from "vitest";
import { resolveProjectIssueAction } from "../src/projects/project-issue-action-routing";
import type { ProjectIssueRoutingCandidate } from "../src/projects/project-repository";

const linearDestination = {
  provider: "linear" as const,
  teamId: "a86813e7-c458-4af2-8cfa-73a796d81201",
};

const project: ProjectIssueRoutingCandidate = {
  id: "project-payments",
  name: "Payments",
  slug: "payments",
  repositoryUrl: "https://github.com/amplifthq/payments",
  routing: {
    projectId: "project-payments",
    destination: linearDestination,
    revision: 3,
    updatedAtMs: 42,
    updatedByUserId: "owner",
  },
};

describe("Project issue action routing", () => {
  it("uses the configured Linear target when a GitHub PR is background context", () => {
    const requestText =
      "File an issue about https://github.com/amplifthq/payments/pull/82";
    expect(
      resolveProjectIssueAction({
        projects: [project],
        proposedDestination: linearDestination,
        requestText,
      })
    ).toMatchObject({
      basis: "project_default",
      destination: project.routing.destination,
      projectId: project.id,
      projectRevision: 3,
    });
    expect(() =>
      resolveProjectIssueAction({
        projects: [project],
        proposedDestination: {
          provider: "github",
          owner: "amplifthq",
          repo: "payments",
        },
        requestText,
      })
    ).toThrow("New issues for Payments go to Linear");
    expect(
      resolveProjectIssueAction({
        projects: [project],
        proposedDestination: linearDestination,
        requestText:
          "File an issue about the GitHub issue discussed in https://github.com/amplifthq/payments/pull/82",
      }).basis
    ).toBe("project_default");
    expect(
      resolveProjectIssueAction({
        projects: [project],
        proposedDestination: linearDestination,
        requestText:
          "File an issue about https://github.com/amplifthq/payments/pull/82\n> Create a GitHub issue in this repository",
      }).basis
    ).toBe("project_default");
  });

  it("honors a clear GitHub override without changing the Project rule", () => {
    expect(
      resolveProjectIssueAction({
        projects: [project],
        proposedDestination: {
          provider: "github",
          owner: "amplifthq",
          repo: "payments",
        },
        requestText:
          "Create a GitHub issue in the repo for https://github.com/amplifthq/payments/pull/82",
      })
    ).toMatchObject({
      basis: "explicit_request",
      projectId: project.id,
      projectRevision: null,
    });
  });

  it("blocks a shared repository when Project attribution would change the destination", () => {
    expect(() =>
      resolveProjectIssueAction({
        projects: [
          project,
          {
            ...project,
            id: "project-platform",
            name: "Platform",
            slug: "platform",
            routing: {
              ...project.routing,
              projectId: "project-platform",
              destination: {
                provider: "github",
                owner: "amplifthq",
                repo: "payments",
              },
            },
          },
        ],
        proposedDestination: linearDestination,
        requestText:
          "Create an issue about https://github.com/amplifthq/payments/pull/82",
      })
    ).toThrow("Choose the Project");
  });

  it("uses an exact request target without requiring a Project", () => {
    expect(
      resolveProjectIssueAction({
        projects: [],
        proposedDestination: {
          provider: "github",
          owner: "amplifthq",
          repo: "openmeld",
        },
        requestText: "Create an issue in amplifthq/openmeld for this bug.",
      })
    ).toMatchObject({
      basis: "object_context",
      projectId: null,
      projectRevision: null,
    });
  });

  it("keeps a Task's Project default when the cited PR belongs to another Project", () => {
    const codeProject: ProjectIssueRoutingCandidate = {
      ...project,
      id: "project-code",
      name: "Code Platform",
      slug: "code-platform",
      repositoryUrl: "https://github.com/amplifthq/sdk",
      routing: {
        ...project.routing,
        projectId: "project-code",
        destination: {
          provider: "github",
          owner: "amplifthq",
          repo: "sdk",
        },
      },
    };
    expect(
      resolveProjectIssueAction({
        projects: [project, codeProject],
        proposedDestination: linearDestination,
        requestText:
          "File an issue about https://github.com/amplifthq/sdk/pull/82",
        taskProjectIds: [project.id],
      })
    ).toMatchObject({ basis: "project_default", projectId: project.id });
  });
});
