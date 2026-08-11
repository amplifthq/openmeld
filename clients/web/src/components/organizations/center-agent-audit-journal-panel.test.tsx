import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CenterAgentAuditJournalPanel } from "./center-agent-audit-journal-panel";

const listCurrentCenterAgentAuditJournalMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/organizations/center-agent", async () => {
	const actual = await vi.importActual<
		typeof import("#/lib/organizations/center-agent")
	>("#/lib/organizations/center-agent");
	return {
		...actual,
		listCurrentCenterAgentAuditJournal: listCurrentCenterAgentAuditJournalMock,
	};
});

afterEach(() => {
	listCurrentCenterAgentAuditJournalMock.mockReset();
});

describe("CenterAgentAuditJournalPanel", () => {
	it("keeps the empty state labeled as an audit log", async () => {
		listCurrentCenterAgentAuditJournalMock.mockResolvedValue({
			entries: [],
			organizationId: "org-acme",
		});

		render(
			<QueryClientProvider client={new QueryClient()}>
				<CenterAgentAuditJournalPanel
					enabled
					members={[]}
					organizationId="org-acme"
					profiles={[]}
				/>
			</QueryClientProvider>
		);

		expect(
			await screen.findByText("No Center Agent audit entries yet.")
		).toBeTruthy();
		expect(screen.queryByText("No Center Agent activity yet.")).toBeNull();
	});

	it("shows the organization-readable audit journal with actor and resource context", async () => {
		listCurrentCenterAgentAuditJournalMock.mockResolvedValue({
			entries: [
				{
					action: "create_space",
					actorProfileId: "agent-center",
					createdAt: new Date().toISOString(),
					id: "audit-1",
					onBehalfOf: null,
					organizationId: "org-acme",
					resource: { id: "space-1", type: "space" },
				},
			],
			organizationId: "org-acme",
		});

		render(
			<QueryClientProvider client={new QueryClient()}>
				<CenterAgentAuditJournalPanel
					enabled
					members={[]}
					organizationId="org-acme"
					profiles={[]}
				/>
			</QueryClientProvider>
		);

		expect(await screen.findByText("Created Space")).toBeTruthy();
		expect(screen.getByText("Center Agent · Space")).toBeTruthy();
		expect(screen.getByText("Details")).toBeTruthy();
	});

	it("uses clear labels for every Center Agent Project action", async () => {
		const createdAt = new Date().toISOString();
		listCurrentCenterAgentAuditJournalMock.mockResolvedValue({
			entries: [
				"read_projects",
				"create_project",
				"update_project",
				"set_agent_profile_default_project",
				"prepare_remove_project",
				"remove_project",
			].map((action, index) => ({
				action,
				actorProfileId: "agent-center",
				createdAt,
				id: `audit-project-${index}`,
				onBehalfOf: null,
				organizationId: "org-acme",
				resource: { id: "project-1", type: "project" },
			})),
			organizationId: "org-acme",
		});

		render(
			<QueryClientProvider client={new QueryClient()}>
				<CenterAgentAuditJournalPanel
					enabled
					members={[]}
					organizationId="org-acme"
					profiles={[]}
				/>
			</QueryClientProvider>
		);

		expect(await screen.findByText("Read Projects")).toBeTruthy();
		expect(screen.getByText("Created Project")).toBeTruthy();
		expect(screen.getByText("Updated Project")).toBeTruthy();
		expect(screen.getByText("Set Agent Profile Default Project")).toBeTruthy();
		expect(screen.getByText("Prepared Project removal")).toBeTruthy();
		expect(screen.getByText("Removed Project")).toBeTruthy();
		expect(screen.getAllByText("Center Agent · Project")).toHaveLength(6);
	});

	it("labels a member Service-status read without exposing device details", async () => {
		listCurrentCenterAgentAuditJournalMock.mockResolvedValue({
			entries: [
				{
					action: "read_member_openmeld_service_status",
					actorProfileId: "agent-center",
					createdAt: new Date().toISOString(),
					id: "audit-member-service-status",
					onBehalfOf: null,
					organizationId: "org-acme",
					resource: { id: "user-1", type: "organization_member" },
				},
			],
			organizationId: "org-acme",
		});

		render(
			<QueryClientProvider client={new QueryClient()}>
				<CenterAgentAuditJournalPanel
					enabled
					members={[]}
					organizationId="org-acme"
					profiles={[]}
				/>
			</QueryClientProvider>
		);

		expect(await screen.findByText("Read member Service status")).toBeTruthy();
		expect(screen.queryByText("Felix's MacBook")).toBeNull();
	});

	it("names the Local Agent carrier without exposing a session locator", async () => {
		listCurrentCenterAgentAuditJournalMock.mockResolvedValue({
			entries: [
				{
					action: "receive_local_agent_request",
					actorProfileId: "agt_center",
					createdAt: "2026-08-09T00:00:00.000Z",
					id: "audit-local-agent-request",
					onBehalfOf: {
						displayName: "Mira",
						profileId: "human-1",
						userId: "user-1",
					},
					organizationId: "org-acme",
					resource: { id: "codex", type: "local_agent_client" },
				},
			],
			organizationId: "org-acme",
		});

		render(
			<QueryClientProvider client={new QueryClient()}>
				<CenterAgentAuditJournalPanel
					enabled
					members={[]}
					organizationId="org-acme"
					profiles={[]}
				/>
			</QueryClientProvider>
		);

		expect(await screen.findByText("Received request via Codex")).toBeTruthy();
		expect(
			screen.getAllByText("Center Agent · Requested by Mira via Codex").length
		).toBeGreaterThan(0);
		expect(document.body.textContent).not.toContain("session");
	});

	it("shows prepared context precisely without exposing manifest internals", async () => {
		listCurrentCenterAgentAuditJournalMock.mockResolvedValue({
			entries: [
				{
					action: "read_center_agent_context",
					actorProfileId: "agt_center",
					contextManifest: {
						estimatedTokens: 420,
						includedMessages: 3,
						truncated: true,
					},
					createdAt: "2026-08-10T00:00:00.000Z",
					id: "audit-context",
					interactionSource: { client: "codex", kind: "local_agent" },
					onBehalfOf: {
						displayName: "Mira",
						profileId: "human-1",
						userId: "user-1",
					},
					organizationId: "org-acme",
					resource: {
						id: "center_agent_context_manifest_private",
						type: "center_agent_context_manifest",
					},
				},
			],
			organizationId: "org-acme",
		});

		render(
			<QueryClientProvider client={new QueryClient()}>
				<CenterAgentAuditJournalPanel
					enabled
					members={[]}
					organizationId="org-acme"
					profiles={[]}
				/>
			</QueryClientProvider>
		);

		expect(
			await screen.findByText("Prepared 3 Center Agent messages for Codex")
		).toBeTruthy();
		expect(
			screen.getByText("3 Center Agent messages · about 420 tokens")
		).toBeTruthy();
		expect(
			screen.getByText(
				"The request used a bounded context window, so older or larger content may not be included."
			)
		).toBeTruthy();
		expect(
			screen.getAllByText("Center Agent · Requested by Mira via Codex").length
		).toBeGreaterThan(0);
		expect(document.body.textContent).not.toContain(
			"center_agent_context_manifest_private"
		);
		expect(screen.getAllByText("Codex").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Mira").length).toBeGreaterThan(0);
		expect(document.body.textContent).not.toContain(
			"read_center_agent_context"
		);
		expect(document.body.textContent).not.toContain("agt_center");
		expect(document.body.textContent).not.toContain("human-1");
	});

	it("shows what a Local Agent reported loading without claiming model use", async () => {
		listCurrentCenterAgentAuditJournalMock.mockResolvedValue({
			entries: [
				{
					action: "load_center_agent_context",
					actorProfileId: "agt_center",
					contextLoad: {
						estimatedTokens: 280,
						includedMessages: 2,
						manifestId: "center_agent_context_manifest_private",
					},
					createdAt: "2026-08-10T00:00:01.000Z",
					id: "audit-context-load",
					interactionSource: { client: "codex", kind: "local_agent" },
					onBehalfOf: {
						displayName: "Mira",
						profileId: "human-1",
						userId: "user-1",
					},
					organizationId: "org-acme",
					resource: {
						id: "center_agent_context_load_receipt_private",
						type: "center_agent_context_load_receipt",
					},
				},
			],
			organizationId: "org-acme",
		});

		render(
			<QueryClientProvider client={new QueryClient()}>
				<CenterAgentAuditJournalPanel
					enabled
					members={[]}
					organizationId="org-acme"
					profiles={[]}
				/>
			</QueryClientProvider>
		);

		expect(
			await screen.findByText(
				"Codex added 2 Center Agent messages to its working context"
			)
		).toBeTruthy();
		expect(
			screen.getByText("2 Center Agent messages · about 280 tokens")
		).toBeTruthy();
		expect(
			screen.getByText(
				"This confirms what the Local Agent reported adding to its working context. It does not mean the model used every message in its answer."
			)
		).toBeTruthy();
		expect(
			screen.getAllByText("Center Agent · Requested by Mira via Codex").length
		).toBeGreaterThan(0);
		expect(document.body.textContent).not.toContain(
			"center_agent_context_load_receipt_private"
		);
		expect(document.body.textContent).not.toContain(
			"center_agent_context_manifest_private"
		);
		expect(document.body.textContent).not.toContain("session");
		expect(screen.getAllByText("Codex").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Mira").length).toBeGreaterThan(0);
		expect(document.body.textContent).not.toContain(
			"load_center_agent_context"
		);
		expect(document.body.textContent).not.toContain("agt_center");
		expect(document.body.textContent).not.toContain("human-1");
	});

	it("shows when a Local Agent request led to a durable Routine change", async () => {
		listCurrentCenterAgentAuditJournalMock.mockResolvedValue({
			entries: [
				{
					action: "create_routine",
					actorProfileId: "agt_center",
					createdAt: "2026-08-10T00:00:02.000Z",
					id: "audit-routine-create",
					interactionSource: { client: "codex", kind: "local_agent" },
					onBehalfOf: {
						displayName: "Mira",
						profileId: "human-1",
						userId: "user-1",
					},
					organizationId: "org-acme",
					resource: { id: "routine-1", type: "routine" },
				},
			],
			organizationId: "org-acme",
		});

		render(
			<QueryClientProvider client={new QueryClient()}>
				<CenterAgentAuditJournalPanel
					enabled
					members={[]}
					organizationId="org-acme"
					profiles={[]}
				/>
			</QueryClientProvider>
		);

		expect(await screen.findByText("Created Routine")).toBeTruthy();
		expect(
			screen.getByText("Center Agent · Requested by Mira via Codex · Routine")
		).toBeTruthy();
		expect(screen.getAllByText("Codex").length).toBeGreaterThan(0);
		expect(screen.getByText("routine / routine-1")).toBeTruthy();
	});
});
