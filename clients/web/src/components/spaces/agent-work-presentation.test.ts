import type { AgentWorkActivity } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveAgentWorkPresentation } from "./agent-work-presentation";

describe("Agent work presentation", () => {
	it("uses a safe subject label when one is available", () => {
		const work = {
			v: 1,
			key: "repository.clone",
			subject: {
				kind: "repository",
				label: "amplifthq/reply",
			},
		} satisfies AgentWorkActivity;

		expect(
			resolveAgentWorkPresentation(work, "input-available", true).text
		).toBe("Cloning amplifthq/reply…");
		expect(
			resolveAgentWorkPresentation(work, "output-available", false).text
		).toBe("Cloned amplifthq/reply");
		expect(resolveAgentWorkPresentation(work, "output-error", false).text).toBe(
			"Couldn't clone amplifthq/reply"
		);
	});

	it("describes work instead of exposing implementation tool names", () => {
		expect(
			resolveAgentWorkPresentation(
				{ v: 1, key: "center_agent.task.create" },
				"output-available",
				false
			).text
		).toBe("Created a Task");
		expect(
			resolveAgentWorkPresentation(
				{ v: 1, key: "tests.run" },
				"output-available",
				false
			).text
		).toBe("Ran project tests");
		expect(
			resolveAgentWorkPresentation(
				{
					v: 1,
					key: "connected_app.action.execute",
					subject: {
						kind: "connected_app",
						label: "PostHog: list projects",
					},
				},
				"output-error",
				false
			).text
		).toBe("Couldn't run PostHog: list projects");
		expect(
			resolveAgentWorkPresentation(
				{
					v: 1,
					key: "connected_app.actions.read",
					subject: { kind: "connected_app", label: "PostHog" },
				},
				"output-available",
				false
			).text
		).toBe("Checked PostHog actions");
		expect(
			resolveAgentWorkPresentation(
				{ v: 1, key: "task.watch" },
				"output-available",
				false
			).text
		).toBe("Started a task watch");
		expect(
			resolveAgentWorkPresentation(
				{ v: 1, key: "tasks.read" },
				"output-available",
				false
			).text
		).toBe("Checked recent Agent tasks");
	});

	it("describes Slack channel reads in plain language", () => {
		expect(
			resolveAgentWorkPresentation(
				{ v: 1, key: "slack.channels.read" },
				"input-available",
				true
			).text
		).toBe("Reviewing Slack channels…");
		expect(
			resolveAgentWorkPresentation(
				{ v: 1, key: "slack.channel.members.read" },
				"output-available",
				false
			).text
		).toBe("Reviewed Slack channel members");
		expect(
			resolveAgentWorkPresentation(
				{ v: 1, key: "slack.channel.history.read" },
				"output-error",
				false
			).text
		).toBe("Couldn't review Slack channel history");
	});

	it("describes member Service-status reads precisely", () => {
		expect(
			resolveAgentWorkPresentation(
				{ v: 1, key: "organization.member_service_status.read" },
				"input-available",
				true
			).text
		).toBe("Checking member OpenMeld Service status…");
		expect(
			resolveAgentWorkPresentation(
				{ v: 1, key: "organization.member_service_status.read" },
				"output-available",
				false
			).text
		).toBe("Checked member OpenMeld Service status");
		expect(
			resolveAgentWorkPresentation(
				{ v: 1, key: "organization.member_service_status.read" },
				"output-error",
				false
			).text
		).toBe("Couldn't check member OpenMeld Service status");
	});

	it("describes starting the current member's learning run without claiming it finished", () => {
		expect(
			resolveAgentWorkPresentation(
				{ v: 1, key: "organization.member_research.start" },
				"input-available",
				true
			).text
		).toBe("Starting to learn about you…");
		expect(
			resolveAgentWorkPresentation(
				{ v: 1, key: "organization.member_research.start" },
				"output-available",
				false
			).text
		).toBe("Started learning about you");
		expect(
			resolveAgentWorkPresentation(
				{ v: 1, key: "organization.member_research.start" },
				"output-error",
				false
			).text
		).toBe("Couldn't start learning about you");
	});

	it("uses safe subjects for work beyond repository cloning", () => {
		expect(
			resolveAgentWorkPresentation(
				{
					v: 1,
					key: "project.update",
					subject: { kind: "project", label: "Launch readiness" },
				},
				"output-available",
				false
			).text
		).toBe("Updated a Project — Launch readiness");
		expect(
			resolveAgentWorkPresentation(
				{
					v: 1,
					key: "webpage.read",
					subject: { kind: "website", label: "docs.example.com" },
				},
				"input-available",
				true
			).text
		).toBe("Reading a webpage — docs.example.com…");
	});
});
