import type { GetSpaceEntryResolutionResponse } from "@openmeld/schemas/types";
import {
	QueryClient,
	QueryClientProvider,
	queryOptions,
} from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SpaceDirectoryPreview } from "./space-directory-preview";

const { entryRequest, landing } = vi.hoisted(() => ({
	entryRequest: vi.fn<() => Promise<GetSpaceEntryResolutionResponse>>(),
	landing: vi.fn(),
}));
vi.mock("#/query/spaces/entry-resolution", () => ({
	spaceEntryResolutionQueryOptions: (input: {
		spaceId: string;
		openMeldProfileId: string;
	}) =>
		queryOptions({
			queryKey: ["preview-entry", input.spaceId, input.openMeldProfileId],
			queryFn: entryRequest,
			retry: false,
		}),
}));
vi.mock("./space-landing", () => ({
	SpaceLanding: (input: {
		spaceId: string;
		profileId: string;
		orgSlug: string;
	}) => {
		landing(input);
		return <p>Existing Space conversation</p>;
	},
}));
beforeEach(() => {
	landing.mockClear();
	entryRequest.mockReset();
});
afterEach(cleanup);

function resolution(
	view: GetSpaceEntryResolutionResponse["view"]
): GetSpaceEntryResolutionResponse {
	return {
		target: { spaceId: "preview-space" },
		view,
		participation: { state: "self_join_available" },
		safeContext: {
			organizationId: "org-acme",
			organizationSlug: "acme",
			spaceName: "Support",
		},
		recovery: null,
	};
}
function setup() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<SpaceDirectoryPreview
				accountProfiles={[]}
				onClose={vi.fn()}
				orgSlug="acme"
				profileId="human-profile"
				space={{ spaceId: "preview-space", name: "Support" }}
			/>
		</QueryClientProvider>
	);
}

it("waits for confirmed access before mounting the existing conversation with the correct identity", async () => {
	let confirm: (value: GetSpaceEntryResolutionResponse) => void = () =>
		undefined;
	entryRequest.mockImplementation(
		() =>
			new Promise((resolve) => {
				confirm = resolve;
			})
	);
	setup();
	await waitFor(() => expect(entryRequest).toHaveBeenCalledOnce());
	expect(landing).not.toHaveBeenCalled();
	act(() => confirm(resolution({ state: "allowed", experience: "public" })));
	expect(await screen.findByText("Existing Space conversation")).toBeTruthy();
	expect(landing).toHaveBeenCalledWith({
		accountProfiles: [],
		spaceId: "preview-space",
		profileId: "human-profile",
		orgSlug: "acme",
	});
});

it("does not expose the conversation when a listed Space requires membership", async () => {
	entryRequest.mockResolvedValue(resolution({ state: "membership_required" }));
	setup();
	await waitFor(() => expect(entryRequest).toHaveBeenCalledOnce());
	await screen.findByRole("dialog", { name: "Preview Support" });
	await screen.findByText("You don't have access to Support");
	expect(landing).not.toHaveBeenCalled();
	expect(screen.queryByText("Existing Space conversation")).toBeNull();
});
