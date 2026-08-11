import { describe, expect, it } from "vitest";
import {
	buildCenterAgentSelfEvolutionRoutineBody,
	buildCenterAgentSelfEvolutionSources,
	CENTER_AGENT_SELF_EVOLUTION_NAME,
	isCenterAgentSelfEvolutionRoutine,
	readCenterAgentSelfEvolutionSlackReportChannelName,
	updateCenterAgentSelfEvolutionSlackReport,
} from "./center-agent-self-evolution";

describe("Center Agent Self-Evolution", () => {
	it("qualifies only active Apps and a connected Slack workspace as learning sources", () => {
		expect(
			buildCenterAgentSelfEvolutionSources({
				appConnections: [
					{
						connectionName: "OpenMeld GitHub",
						scope: "shared",
						service: "github",
						status: "active",
						userId: "user-2",
					},
					{
						connectionName: "Old Linear",
						scope: "shared",
						service: "linear",
						status: "disconnected",
						userId: "user-1",
					},
					{
						connectionName: "OpenMeld GitHub backup",
						scope: "private",
						service: "github",
						status: "active",
						userId: "user-1",
					},
					{
						connectionName: "Another member's private Notion",
						scope: "private",
						service: "notion",
						status: "active",
						userId: "user-2",
					},
				],
				currentUserId: "user-1",
				messageChannels: [
					{
						externalAccountName: "OpenMeld",
						id: "slack-1",
						provider: "slack",
						status: "connected",
					},
					{
						externalAccountName: "OpenMeld Lark",
						id: "lark-1",
						provider: "lark",
						status: "connected",
					},
				],
			})
		).toEqual([
			{
				id: "app:github",
				kind: "app",
				label: "GitHub",
				service: "github",
			},
			{
				connectionId: "slack-1",
				id: "slack:slack-1",
				kind: "slack",
				label: "Slack · OpenMeld",
			},
		]);
	});

	it("builds a bounded recurring Routine that learns, updates Documents, and only recommends follow-up actions", () => {
		const body = buildCenterAgentSelfEvolutionRoutineBody({
			cronExpression: "0 9 * * 1",
			focus:
				"Prioritize product quality, customer pain, and repeated delivery friction.",
			project: {
				id: "project-reply",
				name: "Reply",
				slug: "reply",
			},
			sources: [
				{
					id: "app:github",
					kind: "app",
					label: "GitHub",
					service: "github",
				},
				{
					connectionId: "slack-1",
					id: "slack:slack-1",
					kind: "slack",
					label: "Slack · OpenMeld",
				},
			],
			slackReportChannelName: "reply",
			targetSpaceId: "space-learning",
			timezone: "America/Los_Angeles",
		});

		expect(body).toMatchObject({
			authorizedActions: [
				"organization_documents.save_approved_knowledge",
				"slack.publish_channel_report",
			],
			cronExpression: "0 9 * * 1",
			destinationKind: "space",
			externalActionPolicy: "read_only",
			name: CENTER_AGENT_SELF_EVOLUTION_NAME,
			runAtMs: null,
			scheduleKind: "cron",
			targetSpaceId: "space-learning",
			timezone: "America/Los_Angeles",
		});
		expect(body.instructions).toContain(
			"OpenMeld built-in routine: Center Agent Self-Evolution"
		);
		expect(body.instructions).toContain("GitHub");
		expect(body.instructions).toContain("Slack · OpenMeld");
		expect(body.instructions).toContain("Reply");
		expect(body.instructions).toContain("project-reply");
		expect(body.instructions).toContain("Organization Understanding");
		expect(body.instructions).toContain("Opportunity Ledger");
		expect(body.instructions).toContain("Learning Log — YYYY-MM");
		expect(body.instructions).toContain(
			"Do not create, edit, pause, resume, or delete Routines"
		);
		expect(body.instructions).toContain(
			"Do not write to any selected App or Message Channel except for the configured Slack team report"
		);
		expect(body.instructions).toContain(
			"authorized Slack channel, member, and history read tools"
		);
		expect(body.instructions).toContain("Local Service");
		expect(body.instructions).toContain("Slack team report: #reply");
		expect(body.instructions).toContain(
			"Before finishing this Run, post a concise summary to #reply"
		);
		expect(body.instructions).toContain(
			"Never paste the full Organization Documents into Slack"
		);
		expect(body.instructions).toContain(
			"Use an explicitly documented team working language when one exists"
		);
		expect(body.instructions).toContain(
			"Prioritize product quality, customer pain, and repeated delivery friction."
		);
	});

	it("keeps Slack read-only when no team report is configured", () => {
		const body = buildCenterAgentSelfEvolutionRoutineBody({
			cronExpression: "0 9 * * *",
			focus: "Learn from current evidence.",
			project: null,
			sources: [
				{
					connectionId: "slack-1",
					id: "slack:slack-1",
					kind: "slack",
					label: "Slack · OpenMeld",
				},
			],
			slackReportChannelName: null,
			targetSpaceId: "space-learning",
			timezone: "America/Los_Angeles",
		});

		expect(body.authorizedActions).toEqual([
			"organization_documents.save_approved_knowledge",
		]);
		expect(body.instructions).not.toContain("Slack team report:");
	});

	it("updates an existing Self-Evolution team report without rewriting its learning scope", () => {
		const original = buildCenterAgentSelfEvolutionRoutineBody({
			cronExpression: "0 9 * * *",
			focus: "Keep Reply delivery quality moving.",
			project: null,
			sources: [
				{
					connectionId: "slack-1",
					id: "slack:slack-1",
					kind: "slack",
					label: "Slack · OpenMeld",
				},
			],
			slackReportChannelName: null,
			targetSpaceId: "space-learning",
			timezone: "America/Los_Angeles",
		});
		const enabled = updateCenterAgentSelfEvolutionSlackReport({
			instructions: original.instructions,
			slackReportChannelName: "#reply",
		});

		expect(enabled).toContain("Keep Reply delivery quality moving.");
		expect(enabled).toContain("Slack team report: #reply");
		expect(readCenterAgentSelfEvolutionSlackReportChannelName(enabled)).toBe(
			"reply"
		);

		const disabled = updateCenterAgentSelfEvolutionSlackReport({
			instructions: enabled,
			slackReportChannelName: null,
		});
		expect(disabled).toContain("Keep Reply delivery quality moving.");
		expect(disabled).not.toContain("Slack team report:");
		expect(
			readCenterAgentSelfEvolutionSlackReportChannelName(disabled)
		).toBeNull();
	});

	it("uses a stable instruction marker instead of the display name alone", () => {
		expect(
			isCenterAgentSelfEvolutionRoutine({
				instructions:
					"OpenMeld built-in routine: Center Agent Self-Evolution\n\nLearn from GitHub.",
				name: CENTER_AGENT_SELF_EVOLUTION_NAME,
			})
		).toBe(true);
		expect(
			isCenterAgentSelfEvolutionRoutine({
				instructions: "A user-created routine with the same name.",
				name: CENTER_AGENT_SELF_EVOLUTION_NAME,
			})
		).toBe(false);
	});
});
