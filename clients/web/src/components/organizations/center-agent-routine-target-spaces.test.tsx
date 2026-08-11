import type {
	CenterAgentRoutine,
	CenterAgentRoutineTargetSpace,
} from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { CenterAgentRoutinesPanel } from "./center-agent-routines-panel";

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

vi.mock("./center-agent-self-evolution-card", () => ({
	CenterAgentSelfEvolutionCard: () => null,
}));

const ORGANIZATION_ID = "org-1";
const ROUTINES_PATH = "/v1/organizations/current/routines";
const ROUTINES_MANAGEMENT_CONTRACT = "management-v1";
const ROUTINES_PRACTICAL_CONTRACT = "practical-v2";
const ROUTINE_TARGET_SPACES_PATH =
	"/v1/organizations/current/routine-target-spaces";
const CENTER_AGENT_DM_PATH = "/v1/organizations/current/center-agent/dm-space";
const ORDINARY_SPACES_PATH = "/v1/organizations/current/spaces";
const TARGET_IDENTITY_MISMATCH_PATTERN =
	/Routine target Space list identity mismatch/;
const INVALID_RESPONSE_CODE_PATTERN = /Error code: gateway.invalid_response/;
const TARGET_PREPARATION_ERROR_PATTERN =
	/OpenMeld could not prepare eligible target Spaces/;
const DM_OPEN_REQUEST_ID_PATTERN = /Request ID: req-dm-open/;
const TARGET_LIST_REQUEST_ID_PATTERN = /Request ID: req-target-list/;

describe("Center Agent Routine target Spaces", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"fetch",
			createRouteFetch(
				new Map([
					[
						`GET ${url(ROUTINES_PATH)}`,
						() => routineListResponse(ORGANIZATION_ID, []),
					],
					[
						`POST ${url(CENTER_AGENT_DM_PATH)}`,
						() => centerAgentDirectMessageResponse(ORGANIZATION_ID),
					],
					[
						`GET ${url(ROUTINE_TARGET_SPACES_PATH)}`,
						() => targetSpacesResponse(ORGANIZATION_ID, []),
					],
				])
			)
		);
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("opens the current Center Agent conversation before reading only canonical eligible targets", async () => {
		vi.stubGlobal(
			"fetch",
			createRouteFetch(
				new Map([
					[
						`GET ${url(ROUTINES_PATH)}`,
						() => routineListResponse(ORGANIZATION_ID, []),
					],
					[
						`POST ${url(CENTER_AGENT_DM_PATH)}`,
						() => centerAgentDirectMessageResponse(ORGANIZATION_ID),
					],
					[
						`GET ${url(ROUTINE_TARGET_SPACES_PATH)}`,
						() =>
							targetSpacesResponse(ORGANIZATION_ID, [
								{
									kind: "space",
									name: "Public roadmap",
									spaceId: "space-public",
								},
								{
									kind: "space",
									name: "Private planning",
									spaceId: "space-private",
								},
								{
									kind: "center_agent_dm",
									name: "Member and Center Agent",
									spaceId: "space-current-ca-dm",
								},
								{
									kind: "space",
									name: "Two-person project room",
									spaceId: "space-ordinary-two-person",
								},
							]),
					],
				])
			)
		);

		renderPanel({ organizationId: ORGANIZATION_ID, orgSlug: "acme" });
		fireEvent.click(
			await screen.findByRole("button", { name: "Create routine" })
		);
		const dialog = await screen.findByRole("dialog", {
			name: "Create routine",
		});
		await waitFor(() => {
			expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
		});
		const targetPicker = await within(dialog).findByRole("combobox", {
			name: "Target Space",
		});
		fireEvent.click(targetPicker);

		for (const optionName of [
			"Public roadmap",
			"Private planning",
			"Member and Center Agent — Center Agent conversation",
			"Two-person project room",
		]) {
			expect(
				await screen.findByRole("option", { name: optionName })
			).toBeTruthy();
		}
		for (const excludedName of [
			"Unavailable publication",
			"Legacy welcoming",
			"Another member and Center Agent",
			"Latest degraded Center Agent DM",
		]) {
			expect(screen.queryByRole("option", { name: excludedName })).toBeNull();
		}

		const routes = vi
			.mocked(fetch)
			.mock.calls.map(([resource, init]) =>
				resolveRequestRoute(resource, init)
			);
		expect(routes).toEqual([
			`GET ${url(ROUTINES_PATH)}`,
			`POST ${url(CENTER_AGENT_DM_PATH)}`,
			`GET ${url(ROUTINE_TARGET_SPACES_PATH)}`,
		]);
		expect(routes).not.toContain(`GET ${url(ORDINARY_SPACES_PATH)}`);
	});

	it("requires an eligible replacement before saving an unavailable current target", async () => {
		const routine = buildRoutine({
			id: "routine-unavailable-target",
			targetSpaceId: "space-unavailable",
		});
		let patchCount = 0;
		stubRoutineTargetEdit({
			patchResponse: () => {
				patchCount += 1;
				return jsonResponse(
					{
						error: {
							code: "routine.target_space_publication_unavailable",
							message: "The target Space is not eligible for publication.",
							requestId: "req-target-ineligible",
						},
						ok: false,
					},
					409
				);
			},
			routine,
			targetSpaces: [
				{
					kind: "space",
					name: "Available planning",
					spaceId: "space-available",
				},
			],
		});

		renderPanel({ organizationId: ORGANIZATION_ID, orgSlug: "acme" });
		fireEvent.click(
			await screen.findByRole("button", { name: `Edit ${routine.name}` })
		);
		const dialog = await screen.findByRole("dialog", {
			name: `Edit ${routine.name}`,
		});
		const targetPicker = await within(dialog).findByRole("combobox", {
			name: "Target Space",
		});
		expect(targetPicker.textContent).toContain("Current target (unavailable)");
		expect(targetPicker.parentElement?.textContent).toContain(
			"This routine's current target is no longer available. Choose an eligible replacement before saving this routine."
		);

		fireEvent.change(within(dialog).getByLabelText("Name"), {
			target: { value: "Renamed routine" },
		});
		const saveButton = within(dialog).getByRole("button", {
			name: "Save changes",
		});
		expect(saveButton.getAttribute("aria-disabled")).toBe("true");
		fireEvent.click(saveButton);
		await flushMutationMicrotasks();
		expect(patchCount).toBe(0);
		expect(targetPicker.getAttribute("aria-invalid")).toBe("true");
		expect(targetPicker.getAttribute("aria-errormessage")).toBe(
			"routine-target-space-error"
		);
		expect(document.activeElement).toBe(targetPicker);
	});

	it("submits an explicitly selected eligible replacement", async () => {
		const routine = buildRoutine({
			id: "routine-replacement-target",
			targetSpaceId: "space-unavailable",
		});
		stubRoutineTargetEdit({
			patchResponse: () =>
				jsonResponse({
					routine: {
						...routine,
						targetSpaceId: "space-available",
					},
				}),
			routine,
			targetSpaces: [
				{
					kind: "space",
					name: "Available planning",
					spaceId: "space-available",
				},
			],
		});

		renderPanel({ organizationId: ORGANIZATION_ID, orgSlug: "acme" });
		fireEvent.click(
			await screen.findByRole("button", { name: `Edit ${routine.name}` })
		);
		const dialog = await screen.findByRole("dialog", {
			name: `Edit ${routine.name}`,
		});
		fireEvent.click(
			await within(dialog).findByRole("combobox", { name: "Target Space" })
		);
		fireEvent.click(
			await screen.findByRole("option", { name: "Available planning" })
		);
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Save changes" })
		);

		await waitFor(() => {
			expect(resolvePatchBodies()).toEqual([
				{ targetSpaceId: "space-available" },
			]);
		});
	});

	it("saves other changes without repeating a current target that is freshly eligible", async () => {
		const routine = buildRoutine({
			id: "routine-current-target-eligible",
			targetSpaceId: "space-current",
		});
		stubRoutineTargetEdit({
			patchResponse: () =>
				jsonResponse({
					routine: { ...routine, name: "Renamed eligible routine" },
				}),
			routine,
			targetSpaces: [
				{
					kind: "space",
					name: "Current planning",
					spaceId: routine.targetSpaceId ?? "",
				},
			],
		});

		renderPanel({ organizationId: ORGANIZATION_ID, orgSlug: "acme" });
		fireEvent.click(
			await screen.findByRole("button", { name: `Edit ${routine.name}` })
		);
		const dialog = await screen.findByRole("dialog", {
			name: `Edit ${routine.name}`,
		});
		expect(
			(
				await within(dialog).findByRole("combobox", {
					name: "Target Space",
				})
			).textContent
		).toContain("Current planning");
		fireEvent.change(within(dialog).getByLabelText("Name"), {
			target: { value: "Renamed eligible routine" },
		});
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Save changes" })
		);

		await waitFor(() => {
			expect(resolvePatchBodies()).toEqual([
				{ name: "Renamed eligible routine" },
			]);
		});
	});

	it("blocks saving an unavailable target when no replacement candidate exists", async () => {
		const routine = buildRoutine({
			id: "routine-no-replacement-target",
			targetSpaceId: "space-unavailable",
		});
		stubRoutineTargetEdit({ routine });

		renderPanel({ organizationId: ORGANIZATION_ID, orgSlug: "acme" });
		fireEvent.click(
			await screen.findByRole("button", { name: `Edit ${routine.name}` })
		);
		const dialog = await screen.findByRole("dialog", {
			name: `Edit ${routine.name}`,
		});
		expect(
			await within(dialog).findByText(
				"No eligible replacement Spaces are available. This routine cannot be saved until you create or join a Space where the Center Agent can publish."
			)
		).toBeTruthy();
		expect(
			within(dialog)
				.getByRole("link", { name: "Go to Spaces" })
				.getAttribute("href")
		).toBe("/o/acme/spaces");
		fireEvent.change(within(dialog).getByLabelText("Name"), {
			target: { value: "Blocked without replacement" },
		});
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Save changes" })
		);
		await flushMutationMicrotasks();

		expect(resolvePatchBodies()).toEqual([]);
	});

	it("fails closed on a mismatched target projection and can retry owner truth", async () => {
		let targetReadCount = 0;
		vi.stubGlobal(
			"fetch",
			createRouteFetch(
				new Map([
					[
						`GET ${url(ROUTINES_PATH)}`,
						() => routineListResponse(ORGANIZATION_ID, []),
					],
					[
						`POST ${url(CENTER_AGENT_DM_PATH)}`,
						() => centerAgentDirectMessageResponse(ORGANIZATION_ID),
					],
					[
						`GET ${url(ROUTINE_TARGET_SPACES_PATH)}`,
						() => {
							targetReadCount += 1;
							return targetSpacesResponse(
								targetReadCount === 1 ? "org-other" : ORGANIZATION_ID,
								targetReadCount === 1
									? []
									: [
											{
												kind: "space",
												name: "Recovered target",
												spaceId: "space-recovered",
											},
										]
							);
						},
					],
				])
			)
		);

		renderPanel({ organizationId: ORGANIZATION_ID, orgSlug: "acme" });
		fireEvent.click(
			await screen.findByRole("button", { name: "Create routine" })
		);
		const dialog = await screen.findByRole("dialog", {
			name: "Create routine",
		});
		expect(
			await within(dialog).findByText(TARGET_IDENTITY_MISMATCH_PATTERN)
		).toBeTruthy();
		expect(
			within(dialog).getByText(INVALID_RESPONSE_CODE_PATTERN)
		).toBeTruthy();
		expect(within(dialog).queryByRole("combobox")).toBeNull();

		fireEvent.click(
			within(dialog).getByRole("button", { name: "Retry target Spaces" })
		);
		const picker = await within(dialog).findByRole("combobox", {
			name: "Target Space",
		});
		fireEvent.click(picker);
		expect(
			await screen.findByRole("option", { name: "Recovered target" })
		).toBeTruthy();
		expect(targetReadCount).toBe(2);
	});

	it("does not update a routine while the target projection identity is mismatched", async () => {
		const routine = buildRoutine({
			id: "routine-target-identity-mismatch",
			targetSpaceId: "space-current",
		});
		stubRoutineTargetEdit({ routine, targetOrganizationId: "org-other" });

		renderPanel({ organizationId: ORGANIZATION_ID, orgSlug: "acme" });
		fireEvent.click(
			await screen.findByRole("button", { name: `Edit ${routine.name}` })
		);
		const dialog = await screen.findByRole("dialog", {
			name: `Edit ${routine.name}`,
		});
		const error = await within(dialog).findByText(
			TARGET_IDENTITY_MISMATCH_PATTERN
		);
		fireEvent.change(within(dialog).getByLabelText("Name"), {
			target: { value: "Blocked by identity mismatch" },
		});
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Save changes" })
		);
		await flushMutationMicrotasks();

		expect(resolvePatchBodies()).toEqual([]);
		expect(document.activeElement).toBe(error);
	});

	it("does not update a routine while eligible target preparation has failed", async () => {
		const routine = buildRoutine({
			id: "routine-target-preparation-error",
			targetSpaceId: "space-current",
		});
		stubRoutineTargetEdit({
			directMessageResponse: () =>
				jsonResponse(
					{
						error: {
							code: "center_agent.dm_open_failed",
							message: "Center Agent DM open failed.",
							requestId: "req-dm-open",
						},
						ok: false,
					},
					500
				),
			routine,
		});

		renderPanel({ organizationId: ORGANIZATION_ID, orgSlug: "acme" });
		fireEvent.click(
			await screen.findByRole("button", { name: `Edit ${routine.name}` })
		);
		const dialog = await screen.findByRole("dialog", {
			name: `Edit ${routine.name}`,
		});
		const error = await within(dialog).findByText(
			TARGET_PREPARATION_ERROR_PATTERN
		);
		fireEvent.change(within(dialog).getByLabelText("Name"), {
			target: { value: "Blocked by preparation error" },
		});
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Save changes" })
		);
		await flushMutationMicrotasks();

		expect(resolvePatchBodies()).toEqual([]);
		expect(document.activeElement).toBe(error);
		expect(targetRequestCount()).toBe(0);
	});

	it("does not update a routine when the target projection request fails", async () => {
		const routine = buildRoutine({
			id: "routine-target-projection-error",
			targetSpaceId: "space-current",
		});
		stubRoutineTargetEdit({
			routine,
			targetProjectionResponse: () =>
				jsonResponse(
					{
						error: {
							code: "routine.store_unavailable",
							message: "Routine storage is temporarily unavailable.",
							requestId: "req-target-list",
						},
						ok: false,
					},
					503
				),
		});

		renderPanel({ organizationId: ORGANIZATION_ID, orgSlug: "acme" });
		fireEvent.click(
			await screen.findByRole("button", { name: `Edit ${routine.name}` })
		);
		const dialog = await screen.findByRole("dialog", {
			name: `Edit ${routine.name}`,
		});
		const error = await within(dialog).findByText(
			TARGET_PREPARATION_ERROR_PATTERN
		);
		expect(
			within(dialog).getByText(TARGET_LIST_REQUEST_ID_PATTERN)
		).toBeTruthy();
		fireEvent.change(within(dialog).getByLabelText("Name"), {
			target: { value: "Blocked by target projection error" },
		});
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Save changes" })
		);
		await flushMutationMicrotasks();

		expect(resolvePatchBodies()).toEqual([]);
		expect(document.activeElement).toBe(error);
		expect(targetRequestCount()).toBeGreaterThan(0);
	});

	it("does not let a delayed old-organization projection enter the new organization's picker", async () => {
		const oldTargetResponse = deferred<Response>();
		let routineReadCount = 0;
		let directMessageOpenCount = 0;
		let targetReadCount = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (resource: URL | RequestInfo, init?: RequestInit) => {
				const route = resolveRequestRoute(resource, init);
				if (route === `GET ${url(ROUTINES_PATH)}`) {
					routineReadCount += 1;
					const organizationId = routineReadCount === 1 ? "org-old" : "org-new";
					return routineListResponse(organizationId, []);
				}
				if (route === `POST ${url(CENTER_AGENT_DM_PATH)}`) {
					directMessageOpenCount += 1;
					return centerAgentDirectMessageResponse(
						directMessageOpenCount === 1 ? "org-old" : "org-new"
					);
				}
				if (route === `GET ${url(ROUTINE_TARGET_SPACES_PATH)}`) {
					targetReadCount += 1;
					return targetReadCount === 1
						? await oldTargetResponse.promise
						: targetSpacesResponse("org-new", [
								{
									kind: "space",
									name: "New organization target",
									spaceId: "space-new",
								},
							]);
				}
				throw new Error(`Unexpected Web API request: ${route}`);
			}) as typeof fetch
		);
		const queryClient = createTestQueryClient();
		const view = render(
			<TestQueryClientProvider queryClient={queryClient}>
				<CenterAgentRoutinesPanel
					currentUserId="user-1"
					isPersonalWorkspace={false}
					organizationId="org-old"
					orgSlug="old"
				/>
			</TestQueryClientProvider>
		);

		fireEvent.click(
			await screen.findByRole("button", { name: "Create routine" })
		);
		await waitFor(() => {
			expect(targetReadCount).toBe(1);
		});
		view.rerender(
			<TestQueryClientProvider queryClient={queryClient}>
				<CenterAgentRoutinesPanel
					currentUserId="user-1"
					isPersonalWorkspace={false}
					organizationId="org-new"
					orgSlug="new"
				/>
			</TestQueryClientProvider>
		);
		fireEvent.click(
			await screen.findByRole("button", { name: "Create routine" })
		);
		const newDialog = await screen.findByRole("dialog", {
			name: "Create routine",
		});
		const newPicker = await within(newDialog).findByRole("combobox", {
			name: "Target Space",
		});
		fireEvent.click(newPicker);
		expect(
			await screen.findByRole("option", { name: "New organization target" })
		).toBeTruthy();

		oldTargetResponse.resolve(
			targetSpacesResponse("org-old", [
				{
					kind: "space",
					name: "Old organization target",
					spaceId: "space-old",
				},
			])
		);
		await waitFor(() => {
			expect(
				screen.queryByRole("option", { name: "Old organization target" })
			).toBeNull();
		});
	});

	it("does not expose cached targets while a reopened dialog refreshes owner truth", async () => {
		const refreshedTargetResponse = deferred<Response>();
		let directMessageOpenCount = 0;
		let targetReadCount = 0;
		vi.stubGlobal(
			"fetch",
			createRouteFetch(
				new Map([
					[
						`GET ${url(ROUTINES_PATH)}`,
						() => routineListResponse(ORGANIZATION_ID, []),
					],
					[
						`POST ${url(CENTER_AGENT_DM_PATH)}`,
						() => {
							directMessageOpenCount += 1;
							return centerAgentDirectMessageResponse(ORGANIZATION_ID);
						},
					],
					[
						`GET ${url(ROUTINE_TARGET_SPACES_PATH)}`,
						() => {
							targetReadCount += 1;
							return targetReadCount === 1
								? targetSpacesResponse(ORGANIZATION_ID, [
										{
											kind: "space",
											name: "Cached target",
											spaceId: "space-cached",
										},
									])
								: refreshedTargetResponse.promise;
						},
					],
				])
			)
		);

		renderPanel({ organizationId: ORGANIZATION_ID, orgSlug: "acme" });
		fireEvent.click(
			await screen.findByRole("button", { name: "Create routine" })
		);
		const firstDialog = await screen.findByRole("dialog", {
			name: "Create routine",
		});
		expect(
			await within(firstDialog).findByRole("combobox", { name: "Target Space" })
		).toBeTruthy();
		fireEvent.click(
			within(firstDialog).getByRole("button", { name: "Cancel" })
		);
		await waitFor(() => {
			expect(
				screen.queryByRole("dialog", { name: "Create routine" })
			).toBeNull();
		});

		fireEvent.click(screen.getByRole("button", { name: "Create routine" }));
		const reopenedDialog = await screen.findByRole("dialog", {
			name: "Create routine",
		});
		await waitFor(() => {
			expect(targetReadCount).toBe(2);
		});
		expect(directMessageOpenCount).toBe(2);
		expect(
			within(reopenedDialog).getByText("Preparing eligible target Spaces.")
		).toBeTruthy();
		expect(within(reopenedDialog).queryByRole("combobox")).toBeNull();

		refreshedTargetResponse.resolve(
			targetSpacesResponse(ORGANIZATION_ID, [
				{
					kind: "space",
					name: "Refreshed target",
					spaceId: "space-refreshed",
				},
			])
		);
		const refreshedPicker = await within(reopenedDialog).findByRole(
			"combobox",
			{
				name: "Target Space",
			}
		);
		fireEvent.click(refreshedPicker);
		expect(
			await screen.findByRole("option", { name: "Refreshed target" })
		).toBeTruthy();
		expect(screen.queryByRole("option", { name: "Cached target" })).toBeNull();
	});

	it("keeps an in-flight target preparation usable when the dialog reopens", async () => {
		const directMessageResponse = deferred<Response>();
		let directMessageOpenCount = 0;
		vi.stubGlobal(
			"fetch",
			createRouteFetch(
				new Map<string, () => Promise<Response> | Response>([
					[
						`GET ${url(ROUTINES_PATH)}`,
						() => routineListResponse(ORGANIZATION_ID, []),
					],
					[
						`POST ${url(CENTER_AGENT_DM_PATH)}`,
						() => {
							directMessageOpenCount += 1;
							return directMessageResponse.promise;
						},
					],
					[
						`GET ${url(ROUTINE_TARGET_SPACES_PATH)}`,
						() =>
							targetSpacesResponse(ORGANIZATION_ID, [
								{
									kind: "space",
									name: "Ready after reopen",
									spaceId: "space-ready",
								},
							]),
					],
				])
			)
		);

		renderPanel({ organizationId: ORGANIZATION_ID, orgSlug: "acme" });
		fireEvent.click(
			await screen.findByRole("button", { name: "Create routine" })
		);
		const firstDialog = await screen.findByRole("dialog", {
			name: "Create routine",
		});
		await waitFor(() => {
			expect(directMessageOpenCount).toBe(1);
		});
		fireEvent.click(
			within(firstDialog).getByRole("button", { name: "Cancel" })
		);
		await waitFor(() => {
			expect(
				screen.queryByRole("dialog", { name: "Create routine" })
			).toBeNull();
		});

		fireEvent.click(screen.getByRole("button", { name: "Create routine" }));
		const reopenedDialog = await screen.findByRole("dialog", {
			name: "Create routine",
		});
		expect(directMessageOpenCount).toBe(1);
		directMessageResponse.resolve(
			centerAgentDirectMessageResponse(ORGANIZATION_ID)
		);
		expect(
			await within(reopenedDialog).findByRole("combobox", {
				name: "Target Space",
			})
		).toBeTruthy();
	});

	it("shows a recoverable preparation error and actionable guidance when no target is eligible", async () => {
		let directMessageOpenCount = 0;
		vi.stubGlobal(
			"fetch",
			createRouteFetch(
				new Map([
					[
						`GET ${url(ROUTINES_PATH)}`,
						() => routineListResponse(ORGANIZATION_ID, []),
					],
					[
						`POST ${url(CENTER_AGENT_DM_PATH)}`,
						() => {
							directMessageOpenCount += 1;
							return directMessageOpenCount === 1
								? jsonResponse(
										{
											error: {
												code: "center_agent.dm_open_failed",
												message: "Center Agent DM open failed.",
												requestId: "req-dm-open",
											},
											ok: false,
										},
										500
									)
								: centerAgentDirectMessageResponse(ORGANIZATION_ID);
						},
					],
					[
						`GET ${url(ROUTINE_TARGET_SPACES_PATH)}`,
						() => targetSpacesResponse(ORGANIZATION_ID, []),
					],
				])
			)
		);

		renderPanel({ organizationId: ORGANIZATION_ID, orgSlug: "acme" });
		fireEvent.click(
			await screen.findByRole("button", { name: "Create routine" })
		);
		const dialog = await screen.findByRole("dialog", {
			name: "Create routine",
		});
		expect(
			await within(dialog).findByText(TARGET_PREPARATION_ERROR_PATTERN)
		).toBeTruthy();
		expect(within(dialog).getByText(DM_OPEN_REQUEST_ID_PATTERN)).toBeTruthy();
		expect(targetRequestCount()).toBe(0);

		fireEvent.click(
			within(dialog).getByRole("button", { name: "Retry target Spaces" })
		);
		expect(
			await within(dialog).findByText(
				"No eligible target Spaces are available. Create or join a Space where the Center Agent can publish, then try again."
			)
		).toBeTruthy();
		expect(
			within(dialog)
				.getByRole("link", { name: "Go to Spaces" })
				.getAttribute("href")
		).toBe("/o/acme/spaces");
		expect(targetRequestCount()).toBe(1);
	});
});

function stubRoutineTargetEdit(input: {
	directMessageResponse?: () => Promise<Response> | Response;
	patchResponse?: () => Promise<Response> | Response;
	routine: CenterAgentRoutine;
	targetOrganizationId?: string;
	targetProjectionResponse?: () => Promise<Response> | Response;
	targetSpaces?: CenterAgentRoutineTargetSpace[];
}): void {
	const routes = new Map<string, () => Promise<Response> | Response>([
		[
			`GET ${url(ROUTINES_PATH)}`,
			() => routineListResponse(ORGANIZATION_ID, [input.routine]),
		],
		[
			`POST ${url(CENTER_AGENT_DM_PATH)}`,
			input.directMessageResponse ??
				(() => centerAgentDirectMessageResponse(ORGANIZATION_ID)),
		],
		[
			`GET ${url(ROUTINE_TARGET_SPACES_PATH)}`,
			input.targetProjectionResponse ??
				(() =>
					targetSpacesResponse(
						input.targetOrganizationId ?? ORGANIZATION_ID,
						input.targetSpaces ?? []
					)),
		],
	]);
	if (input.patchResponse) {
		routes.set(
			`PATCH ${url(`${ROUTINES_PATH}/${input.routine.id}`)}`,
			input.patchResponse
		);
	}
	vi.stubGlobal("fetch", createRouteFetch(routes));
}

function renderPanel(input: { organizationId: string; orgSlug: string }) {
	return render(
		<TestQueryClientProvider>
			<CenterAgentRoutinesPanel
				currentUserId="user-1"
				isPersonalWorkspace={false}
				organizationId={input.organizationId}
				orgSlug={input.orgSlug}
			/>
		</TestQueryClientProvider>
	);
}

function buildRoutine(
	input: Partial<CenterAgentRoutine> & Pick<CenterAgentRoutine, "id">
): CenterAgentRoutine {
	const { id, ...overrides } = input;
	return {
		canManage: true,
		createdAtMs: 1_752_200_000_000,
		createdByUserId: "user-1",
		cronExpression: "0 9 * * *",
		destinationKind: "space",
		id,
		instructions: "Review new Feedback Inbox issues.",
		lastRun: null,
		name: "Daily feedback review",
		nextDueAt: 1_752_400_000_000,
		organizationId: ORGANIZATION_ID,
		runAtMs: null,
		scheduleKind: "cron",
		slackChannelId: null,
		slackConversationId: null,
		slackTeamId: null,
		slackThreadLabel: null,
		slackThreadTs: null,
		status: "enabled",
		targetSpaceId: "space-1",
		timezone: "America/Los_Angeles",
		updatedAtMs: 1_752_200_000_000,
		updatedByUserId: "user-1",
		...overrides,
	};
}

function routineListResponse(
	organizationId: string,
	routines: CenterAgentRoutine[]
): Response {
	return jsonResponse({
		currentUserId: "user-1",
		organizationId,
		routines,
	});
}

function centerAgentDirectMessageResponse(organizationId: string): Response {
	return jsonResponse({
		centerAgentProfileId: "agt_11111111-1111-4111-8111-111111111111",
		created: false,
		memberProfileId: "22222222-2222-4222-8222-222222222222",
		organizationId,
		spaceId: `space-ca-dm-${organizationId}`,
	});
}

function targetSpacesResponse(
	organizationId: string,
	spaces: CenterAgentRoutineTargetSpace[]
): Response {
	return jsonResponse({ organizationId, spaces });
}

function targetRequestCount(): number {
	return vi
		.mocked(fetch)
		.mock.calls.filter(
			([resource, init]) =>
				resolveRequestRoute(resource, init) ===
				`GET ${url(ROUTINE_TARGET_SPACES_PATH)}`
		).length;
}

function resolvePatchBodies(): unknown[] {
	return vi
		.mocked(fetch)
		.mock.calls.filter(([, init]) => init?.method === "PATCH")
		.map(([, init]) => JSON.parse(String(init?.body)));
}

async function flushMutationMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

function createRouteFetch(
	routes: Map<string, () => Promise<Response> | Response>
): typeof fetch {
	return vi.fn(async (resource: URL | RequestInfo, init?: RequestInit) => {
		const route = resolveRequestRoute(resource, init);
		const createResponse = routes.get(route);
		if (!createResponse) {
			throw new Error(`Unexpected Web API request: ${route}`);
		}
		const response = await createResponse();
		return route === `GET ${window.location.origin}${ROUTINES_PATH}`
			? await projectRoutineManagementListResponse(response)
			: response;
	});
}

async function projectRoutineManagementListResponse(
	response: Response
): Promise<Response> {
	if (!response.ok) {
		return response;
	}
	const body = (await response.json()) as {
		currentUserId: string;
		organizationId: string;
		routines: CenterAgentRoutine[];
	};
	return jsonResponse(
		{
			...body,
			routines: body.routines.map((routine) => ({
				...routine,
				capabilityState: {
					approvedKnowledge: false,
					canRepair: true,
					externalActionPolicy: "standard",
					slackChannelReport: false,
				},
			})),
		},
		response.status
	);
}

function resolveRequestRoute(
	resource: URL | RequestInfo,
	init?: RequestInit
): string {
	const method =
		init?.method ?? (resource instanceof Request ? resource.method : "GET");
	const requestUrl =
		resource instanceof Request ? resource.url : String(resource);
	const parsedUrl = new URL(requestUrl);
	if (
		parsedUrl.pathname === ROUTINES_PATH ||
		parsedUrl.pathname.startsWith(`${ROUTINES_PATH}/`)
	) {
		const contracts = parsedUrl.searchParams.getAll("contract");
		const expectedContract =
			method === "GET" && parsedUrl.pathname === ROUTINES_PATH
				? ROUTINES_MANAGEMENT_CONTRACT
				: ROUTINES_PRACTICAL_CONTRACT;
		if (contracts.length !== 1 || contracts[0] !== expectedContract) {
			throw new Error(
				`Routine request must opt into the ${expectedContract} contract.`
			);
		}
		parsedUrl.searchParams.delete("contract");
	}
	return `${method} ${parsedUrl.toString()}`;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
		status,
	});
}

function url(path: string): string {
	return `${window.location.origin}${path}`;
}

function deferred<Value>() {
	let resolvePromise!: (value: Value) => void;
	const promise = new Promise<Value>((resolve) => {
		resolvePromise = resolve;
	});
	return { promise, resolve: resolvePromise };
}
