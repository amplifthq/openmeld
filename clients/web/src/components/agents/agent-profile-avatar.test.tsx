import { BroadcastChannel as NativeBroadcastChannel } from "node:worker_threads";
import {
	authProfileViewSchema,
	organizationProfileDirectoryResponseSchema,
} from "@openmeld/schemas";
import type { AuthProfileView } from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CenterAgentChatAvatar } from "#/components/organizations/center-agent-chat-avatar";
import { SpaceMemberAvatars } from "#/components/spaces/space-member-avatars";
import { SpaceMessageProfileAvatar } from "#/components/spaces/space-message-profile-avatar";
import { SpaceProfileIcon } from "#/components/spaces/space-profile-icon";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { applySavedAgentAvatarProfile } from "#/query/profiles/agent-avatar";
import { AgentAvatarProfilesProvider } from "#/query/profiles/agent-avatar-context";
import { AgentAvatarEditor } from "./agent-avatar-editor";
import { AgentProfileControllerAvatar } from "./agent-profile-controller-avatar";
import { RemoteAgentAvatar } from "./remote-agent-avatar";

const readDirectory = vi.hoisted(() => vi.fn());
vi.mock("#/lib/organizations/organization-directory", async (original) => ({
	...(await original<
		typeof import("#/lib/organizations/organization-directory")
	>()),
	readCurrentOrganizationProfileDirectory: readDirectory,
}));

vi.mock("bot-avatars", () => ({
	BotAvatar: ({ type }: { type: string }) => <canvas data-bot-avatar={type} />,
}));

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
const PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";

function renderEntrances(
	client: QueryClient,
	ownerAccountId?: string,
	organizationId = "org-1"
) {
	return render(
		<QueryClientProvider client={client}>
			<AgentAvatarProfilesProvider
				organizationId={organizationId}
				ownerAccountId={ownerAccountId}
			>
				<CenterAgentChatAvatar profileId={PROFILE_ID} profileName="Center" />
				<AgentProfileControllerAvatar
					agentControllerRef={null}
					profileId={PROFILE_ID}
					profileName="Center"
					size={24}
				/>
				<SpaceProfileIcon
					agentControllerRef={null}
					profileId={PROFILE_ID}
					profileKind="agent"
					profileName="Center"
					size="sm"
				/>
				<SpaceMessageProfileAvatar
					agentControllerPending
					agentControllerRef={null}
					displayName="Center"
					profileId={PROFILE_ID}
					profileKind="agent"
				/>
				<RemoteAgentAvatar
					profileId={PROFILE_ID}
					profileName="Center"
					size={24}
				/>
				<SpaceMemberAvatars
					members={[
						{
							profileId: PROFILE_ID,
							profileName: "Center",
							profileKind: "agent",
							agentControllerRef: null,
						},
					]}
				/>
			</AgentAvatarProfilesProvider>
		</QueryClientProvider>
	);
}

function seed(
	client: QueryClient,
	avatarStyle?: AuthProfileView["avatarStyle"],
	controller = "hosted:center-agent"
) {
	const directory = buildDirectory(avatarStyle, controller);
	readDirectory.mockResolvedValue(directory);
	client.setQueryData(
		organizationQueryKeys.profileDirectory("org-1"),
		directory
	);
}

function buildDirectory(
	avatarStyle?: AuthProfileView["avatarStyle"],
	controller = "hosted:center-agent"
) {
	return organizationProfileDirectoryResponseSchema.parse({
		organizationId: "org-1",
		generatedAt: "2026-10-01T00:00:00.000Z",
		members: [],
		agentProfiles: [
			{
				organizationId: "org-1",
				profileId: PROFILE_ID,
				profileName: "Center",
				profileHandle: "center",
				profileKind: "agent",
				isDefault: false,
				status: "active",
				ownerUserId: "owner",
				source: "auth",
				managedRole:
					controller === "hosted:center-agent" ? "center_agent" : null,
				createdByUserId: "owner",
				creatorProfileId: null,
				lastUsedAt: null,
				createdAt: "2026-10-01T00:00:00.000Z",
				updatedAt: "2026-10-01T00:00:00.000Z",
				avatarStyle,
				agentControllerRef: controller,
				isCenterAgent: controller === "hosted:center-agent",
			},
		],
	});
}

describe("Agent avatar identity across entrances", () => {
	it("refreshes another tab after save through real BroadcastChannel without crossing account or organization", async () => {
		vi.stubGlobal("BroadcastChannel", NativeBroadcastChannel);
		const sender = new QueryClient();
		const receiver = new QueryClient();
		const otherAccount = new QueryClient();
		const otherOrganization = new QueryClient();
		for (const client of [sender, receiver, otherAccount]) {
			seed(client, "clover");
		}
		otherOrganization.setQueryData(
			organizationQueryKeys.profileDirectory("org-2"),
			{
				...buildDirectory("clover"),
				organizationId: "org-2",
				agentProfiles: buildDirectory("clover").agentProfiles.map(
					(profile) => ({ ...profile, organizationId: "org-2" })
				),
			}
		);
		const senderView = renderEntrances(sender, "owner");
		const receiverView = renderEntrances(receiver, "owner");
		const otherAccountView = renderEntrances(otherAccount, "different-account");
		const otherOrganizationView = renderEntrances(
			otherOrganization,
			"owner",
			"org-2"
		);
		readDirectory.mockResolvedValue(buildDirectory("flower"));
		await act(async () => {
			await applySavedAgentAvatarProfile(
				sender,
				authProfileViewSchema.parse({
					openMeldProfileId: PROFILE_ID,
					profileName: "Center",
					profileHandle: "center",
					profileKind: "agent",
					isDefault: false,
					status: "active",
					ownerUserId: "owner",
					source: "auth",
					managedRole: "center_agent",
					createdByUserId: "owner",
					creatorProfileId: null,
					lastUsedAt: null,
					createdAt: "2026-10-01T00:00:00.000Z",
					updatedAt: "2026-10-01T01:00:00.000Z",
					avatarStyle: "flower",
				}),
				{ ownerAccountId: "owner", organizationId: "org-1" }
			);
		});
		await waitFor(() =>
			expect(
				receiverView.container.querySelectorAll(
					'canvas[data-bot-avatar="flower"]'
				)
			).toHaveLength(6)
		);
		expect(
			senderView.container.querySelectorAll('canvas[data-bot-avatar="flower"]')
		).toHaveLength(6);
		expect(
			otherAccountView.container.querySelectorAll(
				'canvas[data-bot-avatar="clover"]'
			)
		).toHaveLength(6);
		expect(
			otherOrganizationView.container.querySelectorAll(
				'canvas[data-bot-avatar="clover"]'
			)
		).toHaveLength(6);
	});

	it.each([
		false,
		true,
	])("uses the shared saved profile in an idle editor (canEdit=%s)", (canEdit) => {
		const client = new QueryClient();
		seed(client, "flower");
		const view = render(
			<QueryClientProvider client={client}>
				<AgentAvatarProfilesProvider organizationId="org-1">
					<CenterAgentChatAvatar profileId={PROFILE_ID} profileName="Center" />
					<AgentAvatarEditor
						avatarStyle="clover"
						canEdit={canEdit}
						centerAgent
						onSave={vi.fn()}
						profileId={PROFILE_ID}
						profileName="Center"
						saving={false}
					/>
				</AgentAvatarProfilesProvider>
			</QueryClientProvider>
		);
		expect(
			view.container.querySelectorAll('canvas[data-bot-avatar="flower"]')
		).toHaveLength(2);
		expect(view.queryByRole("button", { name: "Save avatar" })).toBeNull();
	});

	it("previews only an unsaved selection and restores the latest saved profile after failure", async () => {
		const client = new QueryClient();
		seed(client, "clover");
		let rejectSave: (error: Error) => void = () => {
			throw new Error("Save has not started");
		};
		const save = new Promise<void>((_resolve, reject) => {
			rejectSave = reject;
		});
		const view = render(
			<QueryClientProvider client={client}>
				<AgentAvatarProfilesProvider organizationId="org-1">
					<CenterAgentChatAvatar profileId={PROFILE_ID} profileName="Center" />
					<AgentAvatarEditor
						avatarStyle="clover"
						canEdit
						centerAgent
						onSave={() => save}
						profileId={PROFILE_ID}
						profileName="Center"
						saving={false}
					/>
				</AgentAvatarProfilesProvider>
			</QueryClientProvider>
		);
		fireEvent.click(view.getByRole("button", { name: "Next avatar" }));
		expect(
			view.container.querySelectorAll('canvas[data-bot-avatar="clover"]')
		).toHaveLength(1);
		fireEvent.click(view.getByRole("button", { name: "Save avatar" }));
		act(() => {
			seed(client, "flower");
		});
		act(() => {
			rejectSave(new Error("Save unavailable"));
		});
		await waitFor(() =>
			expect(
				view.container.querySelectorAll('canvas[data-bot-avatar="flower"]')
			).toHaveLength(2)
		);
		expect(view.queryByRole("button", { name: "Save avatar" })).toBeNull();
	});

	it("uses the saved Center style and shape even when entrance props omit them", () => {
		const client = new QueryClient();
		seed(client, "clover");
		const view = renderEntrances(client);
		expect(
			view.container.querySelectorAll('canvas[data-bot-avatar="clover"]')
		).toHaveLength(6);
		for (const avatar of view.container.querySelectorAll(
			"[data-avatar-style]"
		)) {
			expect(avatar.getAttribute("data-avatar-shape")).toBe("circle");
		}
	});

	it("updates every mounted entrance from the same profile projection", async () => {
		const client = new QueryClient();
		seed(client, "clover");
		const view = renderEntrances(client);
		readDirectory.mockResolvedValue(buildDirectory("flower"));
		await act(async () =>
			applySavedAgentAvatarProfile(
				client,
				authProfileViewSchema.parse({
					openMeldProfileId: PROFILE_ID,
					profileName: "Center",
					profileHandle: "center",
					profileKind: "agent",
					isDefault: false,
					status: "active",
					ownerUserId: "owner",
					source: "auth",
					managedRole: "center_agent",
					createdByUserId: "owner",
					creatorProfileId: null,
					lastUsedAt: null,
					createdAt: "2026-10-01T00:00:00.000Z",
					updatedAt: "2026-10-01T01:00:00.000Z",
					avatarStyle: "flower",
				})
			)
		);
		await waitFor(() =>
			expect(
				view.container.querySelectorAll('canvas[data-bot-avatar="flower"]')
			).toHaveLength(6)
		);
		expect(
			view.container.querySelector('canvas[data-bot-avatar="clover"]')
		).toBeNull();
	});

	it.each([
		undefined,
		null,
		"automatic",
	] as const)("does not invent a saved Center bot for missing or automatic style %s", (style) => {
		const client = new QueryClient();
		seed(client, style);
		const view = renderEntrances(client);
		expect(view.container.querySelector("canvas[data-bot-avatar]")).toBeNull();
		expect(
			view.container.querySelectorAll('[data-avatar-icon="agent"]')
		).toHaveLength(6);
	});

	it("uses the Remote agent mark regardless of its model vendor", () => {
		const client = new QueryClient();
		seed(client, "automatic", "hosted:remote-agent");
		const view = render(
			<QueryClientProvider client={client}>
				<AgentAvatarProfilesProvider organizationId="org-1">
					<RemoteAgentAvatar
						modelId="openai/gpt-6-sol"
						profileId={PROFILE_ID}
						profileName="Remote"
					/>
					<RemoteAgentAvatar
						modelId="anthropic/claude-opus-5-5"
						profileId={PROFILE_ID}
						profileName="Remote"
					/>
				</AgentAvatarProfilesProvider>
			</QueryClientProvider>
		);
		expect(
			view.container.querySelectorAll('[data-avatar-icon="agent"]')
		).toHaveLength(2);
	});

	it("uses the bound Codex mark and shared rounded square at every entrance", () => {
		const client = new QueryClient();
		seed(client, "automatic", "builtin:codex");
		const view = renderEntrances(client);
		expect(
			view.container.querySelectorAll('[data-testid="local-agent-logo-codex"]')
		).toHaveLength(6);
		for (const avatar of view.container.querySelectorAll(
			"[data-avatar-style]"
		)) {
			expect(avatar.getAttribute("data-avatar-shape")).toBe("rounded-square");
		}
	});

	it("keeps Center identity when a stale entrance supplies a local controller", () => {
		const view = render(
			<SpaceMessageProfileAvatar
				agentControllerRef="builtin:codex"
				displayName="Center"
				isCenterAgent
				profileId={PROFILE_ID}
				profileKind="agent"
			/>
		);
		expect(
			view.container.querySelector('[data-avatar-shape="circle"]')
		).toBeTruthy();
		expect(
			view.container.querySelector('[data-avatar-icon="agent"]')
		).toBeTruthy();
		expect(
			view.container.querySelector('[data-testid="local-agent-logo-codex"]')
		).toBeNull();
	});
});
