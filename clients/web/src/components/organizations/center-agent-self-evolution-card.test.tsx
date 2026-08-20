import type {
	CenterAgentRoutine,
	CenterAgentRoutineManagement,
	CreateCenterAgentRoutineBody,
} from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import {
	buildCenterAgentSelfEvolutionRoutineBody,
	CENTER_AGENT_SELF_EVOLUTION_DEFAULT_FOCUS,
} from "./center-agent-self-evolution";
import { CenterAgentSelfEvolutionCard } from "./center-agent-self-evolution-card";

vi.mock("@tanstack/react-start", async () => {
	const actual = await vi.importActual<typeof import("@tanstack/react-start")>(
		"@tanstack/react-start"
	);
	return {
		...actual,
		createIsomorphicFn: () => {
			let clientImplementation: ((...args: never[]) => unknown) | undefined;
			const builder = {
				client: (implementation: (...args: never[]) => unknown) => {
					clientImplementation = implementation;
					return builder;
				},
				server: () => {
					if (!clientImplementation) {
						throw new Error("Missing client isomorphic implementation.");
					}
					return clientImplementation;
				},
			};
			return builder;
		},
	};
});

const ORGANIZATION_ID = "org-1";
const NON_MANAGER_REPAIR_PATTERN =
	/Ask the Routine creator or an Organization owner or admin/i;
const OPEN_EDIT_PATTERN = /Open Edit below/i;
const SAVED_PERMISSIONS_MISMATCH_PATTERN = /saved permissions do not match/i;

describe("CenterAgentSelfEvolutionCard", () => {
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("recommends Self-Evolution for connected signals and creates the bounded built-in Routine", async () => {
		let resolveCreatedBody:
			| ((body: CreateCenterAgentRoutineBody) => void)
			| undefined;
		const createdBodyPromise = new Promise<CreateCenterAgentRoutineBody>(
			(resolve) => {
				resolveCreatedBody = resolve;
			}
		);
		vi.stubGlobal(
			"fetch",
			createRouteFetch({
				onCreateRoutine: (init) => {
					const createdBody = JSON.parse(
						String(init?.body)
					) as CreateCenterAgentRoutineBody;
					resolveCreatedBody?.(createdBody);
					return jsonResponse(
						{
							routine: buildRoutine(
								createdBody as CreateCenterAgentRoutineBody
							),
						},
						201
					);
				},
				withSources: true,
			})
		);

		renderCard();

		expect(
			await screen.findByRole("heading", {
				name: "Center Agent Self-Evolution",
			})
		).toBeTruthy();
		expect(screen.getByText("Recommended")).toBeTruthy();
		expect(screen.getByText("GitHub")).toBeTruthy();
		expect(screen.getByText("Slack · OpenMeld")).toBeTruthy();

		fireEvent.click(
			screen.getByRole("button", { name: "Set up Self-Evolution" })
		);
		const dialog = await screen.findByRole("dialog", {
			name: "Set up Center Agent Self-Evolution",
		});
		expect(
			(within(dialog).getByLabelText("GitHub") as HTMLInputElement).checked
		).toBe(true);
		expect(
			(within(dialog).getByLabelText("Slack · OpenMeld") as HTMLInputElement)
				.checked
		).toBe(true);

		fireEvent.click(
			within(dialog).getByRole("combobox", { name: "Target Project" })
		);
		fireEvent.click(await screen.findByRole("option", { name: "Reply" }));
		const targetSpace = await screen.findByRole("combobox", {
			name: "Learning archive",
		});
		expect(targetSpace.textContent).toContain("Reply Team Learning Lab");
		expect(
			(
				within(dialog).getByLabelText(
					"Post a concise summary to Slack"
				) as HTMLInputElement
			).checked
		).toBe(false);
		fireEvent.click(
			within(dialog).getByLabelText("Post a concise summary to Slack")
		);
		const slackChannel = within(dialog).getByLabelText("Slack channel");
		fireEvent.change(slackChannel, { target: { value: "#reply" } });
		const enableButton = within(dialog).getByRole("button", {
			name: "Enable Self-Evolution",
		});
		await waitFor(() => {
			expect(enableButton.hasAttribute("data-disabled")).toBe(false);
		});
		fireEvent.click(enableButton);

		const body = await createdBodyPromise;
		expect(body).toMatchObject({
			authorizedActions: [
				"organization_documents.save_approved_knowledge",
				"slack.publish_channel_report",
			],
			cronExpression: "0 9 * * *",
			name: "Center Agent Self-Evolution",
			targetSpaceId: "space-learning",
		});
		expect(body.instructions).toContain("Reply");
		expect(body.instructions).toContain("project-reply");
		expect(body.instructions).toContain("Slack team report: #reply");
	});

	it("can retry after a custom schedule fails admission", async () => {
		const createdBodies: CreateCenterAgentRoutineBody[] = [];
		vi.stubGlobal(
			"fetch",
			createRouteFetch({
				onCreateRoutine: (init) => {
					const createdBody = JSON.parse(
						String(init?.body)
					) as CreateCenterAgentRoutineBody;
					createdBodies.push(createdBody);
					return jsonResponse({ routine: buildRoutine(createdBody) }, 201);
				},
				withSources: true,
			})
		);

		renderCard();
		fireEvent.click(
			await screen.findByRole("button", { name: "Set up Self-Evolution" })
		);
		const dialog = await screen.findByRole("dialog", {
			name: "Set up Center Agent Self-Evolution",
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Custom" }));
		const customSchedule = within(dialog).getByLabelText("Custom schedule");
		fireEvent.change(customSchedule, { target: { value: "*/4 * * * *" } });

		const enableButton = within(dialog).getByRole("button", {
			name: "Enable Self-Evolution",
		});
		await waitFor(() => {
			expect(enableButton.hasAttribute("data-disabled")).toBe(false);
		});
		fireEvent.click(enableButton);
		expect(
			await within(dialog).findByText(
				"Routine schedules must be at least 5 minutes apart."
			)
		).toBeTruthy();
		expect(createdBodies).toHaveLength(0);

		fireEvent.change(customSchedule, { target: { value: "*/5 * * * *" } });
		await waitFor(() => {
			expect(enableButton.hasAttribute("data-disabled")).toBe(false);
		});
		fireEvent.click(enableButton);

		await waitFor(() => {
			expect(createdBodies).toHaveLength(1);
		});
		expect(createdBodies[0]?.cronExpression).toBe("*/5 * * * *");
	});

	it("does not recommend Self-Evolution until the Organization has a connected App or Slack workspace", async () => {
		vi.stubGlobal(
			"fetch",
			createRouteFetch({
				onCreateRoutine: () => {
					throw new Error("The Routine must not be created.");
				},
				withSources: false,
			})
		);

		renderCard();

		await waitFor(() => {
			expect(vi.mocked(fetch)).toHaveBeenCalled();
		});
		expect(
			screen.queryByRole("heading", {
				name: "Center Agent Self-Evolution",
			})
		).toBeNull();
	});

	it("shows a marker-bound Routine with missing capabilities as needing repair", async () => {
		vi.stubGlobal(
			"fetch",
			createRouteFetch({
				onCreateRoutine: () => {
					throw new Error("The Routine must not be created.");
				},
				withSources: true,
			})
		);
		renderCard({
			existingRoutines: [
				{
					...buildRoutine({
						...buildCenterAgentSelfEvolutionRoutineBody({
							cronExpression: "0 9 * * *",
							focus: CENTER_AGENT_SELF_EVOLUTION_DEFAULT_FOCUS,
							project: null,
							sources: [
								{
									connectionId: "slack-1",
									id: "slack:slack-1",
									kind: "slack",
									label: "Slack · OpenMeld",
								},
							],
							targetSpaceId: "space-learning",
							timezone: "America/Los_Angeles",
						}),
						cronExpression: "0 9 * * *",
						targetSpaceId: "space-learning",
						timezone: "America/Los_Angeles",
					}),
					capabilityState: {
						approvedKnowledge: false,
						canRepair: true,
						externalActionPolicy: "standard",
						slackChannelReport: false,
					},
					creationAttribution: { displayName: "Current User" },
				},
			],
		});

		expect(await screen.findByText("Needs repair")).toBeTruthy();
		expect(screen.getByText(SAVED_PERMISSIONS_MISMATCH_PATTERN)).toBeTruthy();
	});

	it("routes a non-manager to someone who can repair the Routine", async () => {
		vi.stubGlobal(
			"fetch",
			createRouteFetch({
				onCreateRoutine: () => {
					throw new Error("The Routine must not be created.");
				},
				withSources: true,
			})
		);
		const routine = buildRoutine(
			buildCenterAgentSelfEvolutionRoutineBody({
				cronExpression: "0 9 * * *",
				focus: CENTER_AGENT_SELF_EVOLUTION_DEFAULT_FOCUS,
				project: null,
				sources: [
					{
						connectionId: "slack-1",
						id: "slack:slack-1",
						kind: "slack",
						label: "Slack · OpenMeld",
					},
				],
				targetSpaceId: "space-learning",
				timezone: "America/Los_Angeles",
			})
		);
		renderCard({
			existingRoutines: [
				{
					...routine,
					canManage: false,
					capabilityState: {
						approvedKnowledge: false,
						canRepair: false,
						externalActionPolicy: "standard",
						slackChannelReport: false,
					},
					creationAttribution: { displayName: "Current User" },
				},
			],
		});

		expect(await screen.findByText(NON_MANAGER_REPAIR_PATTERN)).toBeTruthy();
		expect(screen.queryByText(OPEN_EDIT_PATTERN)).toBeNull();
	});

	it("does not recommend organization Self-Evolution in a personal workspace", async () => {
		vi.stubGlobal(
			"fetch",
			createRouteFetch({
				onCreateRoutine: () => {
					throw new Error("The Routine must not be created.");
				},
				withSources: true,
			})
		);

		renderCard({ isPersonalWorkspace: true });

		await waitFor(() => {
			expect(vi.mocked(fetch)).toHaveBeenCalled();
		});
		expect(
			screen.queryByRole("heading", {
				name: "Center Agent Self-Evolution",
			})
		).toBeNull();
	});

	it.each([
		"apps",
		"channels",
	] as const)("fails closed when the %s source check fails after another source succeeds", async (failedSource) => {
		vi.stubGlobal(
			"fetch",
			createRouteFetch({
				failAppConnections: failedSource === "apps",
				failMessageChannels: failedSource === "channels",
				onCreateRoutine: () => {
					throw new Error("The Routine must not be created.");
				},
				withSources: true,
			})
		);

		renderCard();

		expect(
			await screen.findByRole("heading", {
				name: "Self-Evolution setup is unavailable",
			})
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Set up Self-Evolution" })
		).toBeNull();
	});

	it.each([
		"apps",
		"channels",
	] as const)("fails closed when the %s response belongs to another Organization", async (mismatchedSource) => {
		vi.stubGlobal(
			"fetch",
			createRouteFetch({
				appOrganizationId:
					mismatchedSource === "apps" ? "org-other" : ORGANIZATION_ID,
				messageChannelOrganizationId:
					mismatchedSource === "channels" ? "org-other" : ORGANIZATION_ID,
				onCreateRoutine: () => {
					throw new Error("The Routine must not be created.");
				},
				withSources: true,
			})
		);

		renderCard();

		expect(
			await screen.findByRole("heading", {
				name: "Self-Evolution setup is unavailable",
			})
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Set up Self-Evolution" })
		).toBeNull();
	});
});

function renderCard(
	input: {
		existingRoutines?: readonly CenterAgentRoutineManagement[];
		isPersonalWorkspace?: boolean;
	} = {}
) {
	const queryClient = createTestQueryClient();
	render(
		<TestQueryClientProvider queryClient={queryClient}>
			<CenterAgentSelfEvolutionCard
				currentUserId="user-1"
				existingRoutines={input.existingRoutines ?? []}
				isPersonalWorkspace={input.isPersonalWorkspace ?? false}
				organizationId={ORGANIZATION_ID}
				orgSlug="acme"
			/>
		</TestQueryClientProvider>
	);
}

function createRouteFetch(input: {
	appOrganizationId?: string;
	failAppConnections?: boolean;
	failMessageChannels?: boolean;
	messageChannelOrganizationId?: string;
	onCreateRoutine: (init?: RequestInit) => Promise<Response> | Response;
	withSources: boolean;
}) {
	return vi.fn(
		async (
			resource: URL | RequestInfo,
			init?: RequestInit
		): Promise<Response> => {
			const method =
				init?.method ?? (resource instanceof Request ? resource.method : "GET");
			const url = resource instanceof Request ? resource.url : String(resource);
			const route = `${method} ${url}`;
			const origin = window.location.origin;
			if (
				route ===
				`GET ${origin}/v1/organizations/current/connectors/connections?expectedOrganizationId=${ORGANIZATION_ID}`
			) {
				if (input.failAppConnections) {
					return jsonResponse({ error: "app source check failed" }, 503);
				}
				return jsonResponse({
					connections: input.withSources
						? [
								{
									canDisconnect: true,
									connectionName: "openmeld-github",
									createdAtMs: 1,
									disconnectedAtMs: null,
									organizationId: ORGANIZATION_ID,
									ownerDisplayName: "Felix",
									scope: "shared",
									service: "github",
									status: "active",
									updatedAtMs: 1,
									userId: "user-1",
								},
							]
						: [],
					currentUserId: "user-1",
					organizationId: input.appOrganizationId ?? ORGANIZATION_ID,
				});
			}
			if (route === `GET ${origin}/v1/organizations/current/message-channels`) {
				if (input.failMessageChannels) {
					return jsonResponse({ error: "channel source check failed" }, 503);
				}
				return jsonResponse({
					availableLarkPlatformProviders: [],
					connections: input.withSources
						? [
								{
									externalAccountId: "T1",
									externalAccountName: "OpenMeld",
									grantedCapabilityGroups: [],
									id: "slack-1",
									lastVerifiedAt: null,
									permissionBundleVersion: null,
									provider: "slack",
									reasonCode: null,
									status: "connected",
									transport: "webhook",
								},
							]
						: [],
					organizationId: input.messageChannelOrganizationId ?? ORGANIZATION_ID,
				});
			}
			if (route === `GET ${origin}/v1/organizations/current/projects`) {
				return jsonResponse({
					organizationId: ORGANIZATION_ID,
					projects: [
						{
							archivedAtMs: null,
							canArchive: true,
							canManage: true,
							createdAtMs: 1,
							createdByUserId: "user-1",
							id: "project-reply",
							name: "Reply",
							organizationId: ORGANIZATION_ID,
							repositoryFingerprint: null,
							repositoryUrl: null,
							slug: "reply",
							updatedAtMs: 1,
						},
					],
				});
			}
			if (
				route ===
				`GET ${origin}/v1/organizations/current/directory?includeMemberLastActiveAt=true`
			) {
				return jsonResponse({
					agentProfiles: [],
					generatedAt: "2026-07-26T00:00:00.000Z",
					members: [
						{
							humanProfile: null,
							joinedAt: "2026-07-26T00:00:00.000Z",
							memberId: "member-1",
							organizationId: ORGANIZATION_ID,
							role: "owner",
							user: {
								email: "felix@example.com",
								id: "user-1",
								image: null,
								name: "Felix",
							},
							userId: "user-1",
						},
					],
					organizationId: ORGANIZATION_ID,
				});
			}
			if (
				route ===
				`POST ${origin}/v1/organizations/current/center-agent/dm-space`
			) {
				return jsonResponse({
					centerAgentProfileId: "agt_11111111-1111-4111-8111-111111111111",
					created: false,
					memberProfileId: "22222222-2222-4222-8222-222222222222",
					organizationId: ORGANIZATION_ID,
					spaceId: "space-center-agent",
				});
			}
			if (
				route === `GET ${origin}/v1/organizations/current/routine-target-spaces`
			) {
				return jsonResponse({
					organizationId: ORGANIZATION_ID,
					spaces: [
						{
							kind: "space",
							name: "Reply Team Learning Lab",
							spaceId: "space-learning",
						},
					],
				});
			}
			if (
				route ===
				`POST ${origin}/v1/organizations/current/routines?contract=practical-v2`
			) {
				return await input.onCreateRoutine(init);
			}
			throw new Error(`Unexpected Web API request: ${route}`);
		}
	) as typeof fetch;
}

function buildRoutine(body: CreateCenterAgentRoutineBody): CenterAgentRoutine {
	const {
		authorizedActions: _authorizedActions,
		externalActionPolicy: _externalActionPolicy,
		...publicBody
	} = body;
	return {
		...publicBody,
		canManage: true,
		createdAtMs: 1,
		createdByUserId: "user-1",
		id: "routine-self-evolution",
		lastRun: null,
		nextDueAt: 2,
		organizationId: ORGANIZATION_ID,
		status: "enabled",
		updatedAtMs: 1,
		updatedByUserId: "user-1",
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return Response.json(body, { status });
}
