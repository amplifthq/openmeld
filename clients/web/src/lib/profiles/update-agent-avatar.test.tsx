import { authProfileViewSchema } from "@openmeld/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentAvatarEditor } from "#/components/agents/agent-avatar-editor";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { startQueryKeys } from "#/query/query-keys";
import { updateAgentAvatar } from "./update-agent-avatar";

const update = vi.hoisted(() => vi.fn());
vi.mock("@openmeld/api-client", async (original) => ({
	...(await original<typeof import("@openmeld/api-client")>()),
	createProfilesApi: () => ({ updateAgentAvatar: update }),
}));
vi.mock("#/lib/openmeld-api/client", () => ({
	createUnscopedWebOpenMeldApiFoundation: () => ({}),
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

const PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
function profile(avatarStyle: "automatic" | "fluid") {
	return authProfileViewSchema.parse({
		openMeldProfileId: PROFILE_ID,
		profileName: "Remote",
		profileHandle: "remote",
		profileKind: "agent",
		isDefault: false,
		status: "active",
		ownerUserId: "owner",
		source: "auth",
		managedRole: null,
		createdByUserId: "owner",
		creatorProfileId: null,
		lastUsedAt: null,
		createdAt: "2026-10-01T00:00:00.000Z",
		updatedAt: "2026-10-01T01:00:00.000Z",
		avatarStyle,
	});
}

describe("saved Agent avatar propagation", () => {
	it("broadcasts only a successful save with the caller's account scope and no avatar data", async () => {
		vi.stubGlobal("BroadcastChannel", NativeBroadcastChannel);
		const client = new QueryClient();
		const scope = { ownerAccountId: "editor-account", organizationId: "org-1" };
		const received: unknown[] = [];
		const channel = new NativeBroadcastChannel(
			"openmeld.agent-avatar-invalidation.v1"
		);
		channel.onmessage = (event) => {
			received.push(event.data);
		};
		try {
			update.mockRejectedValueOnce(new Error("Save unavailable"));
			await expect(
				updateAgentAvatar(
					{ profileId: PROFILE_ID, avatarStyle: "fluid" },
					client,
					scope
				)
			).rejects.toThrow();
			update.mockResolvedValueOnce({ profile: profile("fluid") });
			await updateAgentAvatar(
				{ profileId: PROFILE_ID, avatarStyle: "fluid" },
				client,
				scope
			);
			await waitFor(() => expect(received).toHaveLength(1));
			expect(received).toEqual([
				{ type: "agent.avatar.changed", ...scope, profileId: PROFILE_ID },
			]);
		} finally {
			channel.close();
		}
	});

	it("updates every loaded directory and account profile projection only after a successful save", async () => {
		const client = new QueryClient();
		const old = profile("automatic");
		const keys = [
			organizationQueryKeys.directory("org-1"),
			organizationQueryKeys.profileDirectory("org-1"),
			organizationQueryKeys.profileIdentityDirectory("org-1"),
		];
		for (const key of keys) {
			client.setQueryData(key, {
				agentProfiles: [
					{ ...old, profileId: PROFILE_ID, avatarStyle: "automatic" },
					{ profileId: "unrelated", avatarStyle: "fluid" },
				],
			});
		}
		const profileKey = startQueryKeys.profilesForStorageScope("owner");
		client.setQueryData(profileKey, [old]);
		update.mockResolvedValue({ profile: profile("fluid") });
		await updateAgentAvatar(
			{ profileId: PROFILE_ID, avatarStyle: "fluid" },
			client
		);
		expect(update).toHaveBeenCalledWith({
			profileId: PROFILE_ID,
			avatarStyle: "fluid",
		});
		for (const key of keys) {
			expect(client.getQueryData(key)).toMatchObject({
				agentProfiles: [
					{ avatarStyle: "fluid" },
					{ profileId: "unrelated", avatarStyle: "fluid" },
				],
			});
			expect(client.getQueryState(key)?.isInvalidated).toBe(true);
		}
		expect(client.getQueryData(profileKey)).toEqual([profile("fluid")]);
	});

	it("keeps saved identity on failure and restores the editor preview", async () => {
		const client = new QueryClient();
		const key = organizationQueryKeys.profileDirectory("org-1");
		const original = {
			agentProfiles: [{ profileId: PROFILE_ID, avatarStyle: "automatic" }],
		};
		client.setQueryData(key, original);
		update.mockRejectedValue(new Error("Save unavailable"));
		render(
			<QueryClientProvider client={client}>
				<AgentAvatarEditor
					avatarStyle="automatic"
					canEdit
					centerAgent={false}
					onSave={async (avatarStyle) => {
						if (avatarStyle === "automatic" || avatarStyle === "fluid") {
							await updateAgentAvatar(
								{ profileId: PROFILE_ID, avatarStyle },
								client
							);
						}
					}}
					profileId={PROFILE_ID}
					profileName="Remote"
					saving={false}
				/>
			</QueryClientProvider>
		);
		fireEvent.click(screen.getByRole("button", { name: "Next avatar" }));
		fireEvent.click(screen.getByRole("button", { name: "Save avatar" }));
		await waitFor(() =>
			expect(screen.queryByRole("button", { name: "Save avatar" })).toBeNull()
		);
		expect(client.getQueryData(key)).toEqual(original);
		expect(
			document.querySelector('[data-avatar-style="automatic"]')
		).toBeTruthy();
	});
});

import { BroadcastChannel as NativeBroadcastChannel } from "node:worker_threads";
