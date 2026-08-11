import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { startQueryKeys, userQueryKeys } from "#/query/query-keys";
import { spaceQueryKeys } from "#/query/spaces/status";
import {
	useRemoveAccountAvatar,
	useUpdateAccountAvatar,
} from "./account.hooks";

const removeAccountAvatarMock = vi.hoisted(() => vi.fn());
const updateAccountAvatarMock = vi.hoisted(() => vi.fn());
const createObjectUrlMock = vi.fn();
const revokeObjectUrlMock = vi.fn();

vi.mock("#/query/auth-query", () => ({
	changeUserPassword: vi.fn(),
	generateOneTimeToken: vi.fn(),
	getAccountAvatar: vi.fn(),
	linkSocialProvider: vi.fn(),
	removeAccountAvatar: removeAccountAvatarMock,
	removePasskey: vi.fn(),
	revokeOtherUserSessions: vi.fn(),
	revokeSessionByToken: vi.fn(),
	setUserPassword: vi.fn(),
	unlinkAccountProvider: vi.fn(),
	updateAccountAvatar: updateAccountAvatarMock,
	updateUserName: vi.fn(),
}));

describe("account avatar hooks", () => {
	beforeEach(() => {
		Object.defineProperties(URL, {
			createObjectURL: {
				configurable: true,
				value: createObjectUrlMock,
				writable: true,
			},
			revokeObjectURL: {
				configurable: true,
				value: revokeObjectUrlMock,
				writable: true,
			},
		});
		createObjectUrlMock.mockReset().mockReturnValue("blob:optimistic-avatar");
		revokeObjectUrlMock.mockReset();
		removeAccountAvatarMock.mockReset().mockResolvedValue({
			avatar: null,
			defaultHumanProfileId: "human-profile-1",
			ok: true,
		});
		updateAccountAvatarMock.mockReset().mockResolvedValue({
			avatar: "https://example.com/new-avatar.webp",
			defaultHumanProfileId: "human-profile-1",
			ok: true,
		});
	});

	it("removes the committed avatar from active identity caches before refetching", async () => {
		const queryClient = createIdentityQueryClient();
		const profileQueryKey = seedIdentityQueries(queryClient);
		const wrapper = createWrapper(queryClient);
		const { result } = renderHook(
			() =>
				useRemoveAccountAvatar({
					defaultHumanProfileId: "human-profile-1",
				}),
			{
				wrapper,
			}
		);

		await act(async () => {
			await result.current.mutateAsync();
		});

		expect(
			queryClient.getQueryData<{ user: { image: string | null } }>(
				userQueryKeys.session
			)?.user.image
		).toBeNull();
		expect(readCanonicalAccountAvatar(queryClient)).toBeNull();
		expect(
			queryClient.getQueryData<
				readonly { avatarUrl?: string; openMeldProfileId: string }[]
			>(profileQueryKey)?.[0]?.avatarUrl
		).toBeUndefined();
		expect(readSpaceMemberAvatar(queryClient)).toBeNull();
		expect(readSpaceBootstrapMemberAvatar(queryClient)).toBeNull();
	});

	it("shows an uploaded avatar across Account, Directory, and Space caches before the request completes", async () => {
		let resolveUpdate!: (value: {
			avatar: string;
			defaultHumanProfileId: string;
			ok: true;
		}) => void;
		updateAccountAvatarMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveUpdate = resolve;
				})
		);
		const queryClient = createIdentityQueryClient();
		const profileQueryKey = seedIdentityQueries(queryClient);
		const wrapper = createWrapper(queryClient);
		const { result } = renderHook(
			() =>
				useUpdateAccountAvatar({
					defaultHumanProfileId: "human-profile-1",
				}),
			{ wrapper }
		);

		let mutation!: Promise<unknown>;
		act(() => {
			mutation = result.current.mutateAsync({
				bytes: new Blob([new Uint8Array([1])], { type: "image/webp" }),
				mimeType: "image/webp",
			});
		});

		await waitFor(() => {
			expect(readSessionAvatar(queryClient)).toBe("blob:optimistic-avatar");
		});
		expect(readCanonicalAccountAvatar(queryClient)).toBe(
			"blob:optimistic-avatar"
		);
		expect(readProfileAvatar(queryClient, profileQueryKey)).toBe(
			"blob:optimistic-avatar"
		);
		expect(readDirectoryAvatar(queryClient)).toBe("blob:optimistic-avatar");
		expect(readSpaceMemberAvatar(queryClient)).toBe("blob:optimistic-avatar");
		expect(readSpaceBootstrapMemberAvatar(queryClient)).toBe(
			"blob:optimistic-avatar"
		);
		expect(createObjectUrlMock).toHaveBeenCalledTimes(1);

		resolveUpdate({
			avatar: "https://example.com/new-avatar.webp",
			defaultHumanProfileId: "human-profile-1",
			ok: true,
		});
		await act(async () => {
			await mutation;
		});

		expect(readSessionAvatar(queryClient)).toBe(
			"https://example.com/new-avatar.webp"
		);
		expect(readCanonicalAccountAvatar(queryClient)).toBe(
			"https://example.com/new-avatar.webp"
		);
		expect(readProfileAvatar(queryClient, profileQueryKey)).toBe(
			"https://example.com/new-avatar.webp"
		);
		expect(readDirectoryAvatar(queryClient)).toBe(
			"https://example.com/new-avatar.webp"
		);
		expect(readSpaceMemberAvatar(queryClient)).toBe(
			"https://example.com/new-avatar.webp"
		);
		expect(readSpaceBootstrapMemberAvatar(queryClient)).toBe(
			"https://example.com/new-avatar.webp"
		);
		expect(revokeObjectUrlMock).toHaveBeenCalledWith("blob:optimistic-avatar");
	});

	it("optimistically removes an avatar and restores every projection when the request fails", async () => {
		let rejectRemoval!: (reason: unknown) => void;
		removeAccountAvatarMock.mockImplementationOnce(
			() =>
				new Promise((_resolve, reject) => {
					rejectRemoval = reject;
				})
		);
		const queryClient = createIdentityQueryClient();
		const profileQueryKey = seedIdentityQueries(queryClient);
		const wrapper = createWrapper(queryClient);
		const { result } = renderHook(
			() =>
				useRemoveAccountAvatar({
					defaultHumanProfileId: "human-profile-1",
				}),
			{ wrapper }
		);

		let mutation!: Promise<unknown>;
		act(() => {
			mutation = result.current.mutateAsync();
		});

		await waitFor(() => {
			expect(readSessionAvatar(queryClient)).toBeNull();
		});
		expect(readCanonicalAccountAvatar(queryClient)).toBeNull();
		expect(readProfileAvatar(queryClient, profileQueryKey)).toBeUndefined();
		expect(readDirectoryAvatar(queryClient)).toBeNull();
		expect(readSpaceMemberAvatar(queryClient)).toBeNull();
		expect(readSpaceBootstrapMemberAvatar(queryClient)).toBeNull();

		rejectRemoval(new Error("Avatar removal failed."));
		await act(async () => {
			await expect(mutation).rejects.toThrow("Avatar removal failed.");
		});

		expect(readSessionAvatar(queryClient)).toBe(
			"https://example.com/old-avatar.webp"
		);
		expect(readCanonicalAccountAvatar(queryClient)).toBe(
			"https://example.com/old-avatar.webp"
		);
		expect(readProfileAvatar(queryClient, profileQueryKey)).toBe(
			"https://example.com/old-avatar.webp"
		);
		expect(readDirectoryAvatar(queryClient)).toBe(
			"https://example.com/old-avatar.webp"
		);
		expect(readSpaceMemberAvatar(queryClient)).toBe(
			"https://example.com/old-avatar.webp"
		);
		expect(readSpaceBootstrapMemberAvatar(queryClient)).toBe(
			"https://example.com/old-avatar.webp"
		);
	});
});

function createIdentityQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: { retry: false },
		},
	});
}

function createWrapper(queryClient: QueryClient) {
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}

function seedIdentityQueries(queryClient: QueryClient) {
	const profileQueryKey = startQueryKeys.profilesForStorageScope("account-1");
	queryClient.setQueryData(userQueryKeys.session, {
		session: { id: "session-1" },
		user: {
			email: "ada@example.com",
			id: "user-1",
			image: "https://example.com/old-avatar.webp",
			name: "Ada Lovelace",
		},
	});
	queryClient.setQueryData(userQueryKeys.accountAvatar, {
		avatar: "https://example.com/old-avatar.webp",
		defaultHumanProfileId: "human-profile-1",
		ok: true,
	});
	queryClient.setQueryData(profileQueryKey, [
		{
			avatarUrl: "https://example.com/old-avatar.webp",
			createdAt: "2026-07-01T00:00:00.000Z",
			createdByUserId: "user-1",
			creatorProfileId: null,
			isDefault: true,
			lastUsedAt: null,
			managedRole: null,
			ownerUserId: "user-1",
			profileHandle: "ada",
			profileKind: "human",
			profileName: "Ada Lovelace",
			source: "account",
			status: "active",
			updatedAt: "2026-07-01T00:00:00.000Z",
			openMeldProfileId: "human-profile-1",
		},
	]);
	queryClient.setQueryData(organizationQueryKeys.directory("organization-1"), {
		agentProfiles: [],
		generatedAt: "2026-07-01T00:00:00.000Z",
		members: [
			{
				humanProfile: {
					lastUsedAt: "2026-07-01T00:00:00.000Z",
					profileHandle: "ada",
					profileId: "human-profile-1",
					profileName: "Ada Lovelace",
					status: "active",
				},
				joinedAt: "2026-07-01T00:00:00.000Z",
				memberId: "member-1",
				organizationId: "organization-1",
				role: "owner",
				user: {
					email: "ada@example.com",
					id: "user-1",
					image: "https://example.com/old-avatar.webp",
					name: "Ada Lovelace",
				},
				userId: "user-1",
			},
		],
		organizationId: "organization-1",
	});
	const spaceMembers = {
		agents: [],
		generatedAt: "2026-07-01T00:00:00.000Z",
		humans: [
			{
				avatarUrl: "https://example.com/old-avatar.webp",
				profileId: "human-profile-1",
			},
		],
		spaceId: "space-1",
		summary: {
			agentCount: 0,
			humanCount: 1,
			liveNowCount: 1,
			totalCount: 1,
		},
	};
	queryClient.setQueryData(
		spaceQueryKeys.members("space-1", "human-profile-1"),
		spaceMembers
	);
	queryClient.setQueryData(
		spaceQueryKeys.bootstrap("space-1", "human-profile-1"),
		{ members: spaceMembers }
	);
	return profileQueryKey;
}

function readSessionAvatar(
	queryClient: QueryClient
): string | null | undefined {
	return queryClient.getQueryData<{ user: { image: string | null } }>(
		userQueryKeys.session
	)?.user.image;
}

function readCanonicalAccountAvatar(
	queryClient: QueryClient
): string | null | undefined {
	return queryClient.getQueryData<{ avatar: string | null }>(
		userQueryKeys.accountAvatar
	)?.avatar;
}

function readProfileAvatar(
	queryClient: QueryClient,
	profileQueryKey: ReturnType<typeof startQueryKeys.profilesForStorageScope>
): string | undefined {
	return queryClient.getQueryData<
		readonly { avatarUrl?: string; openMeldProfileId: string }[]
	>(profileQueryKey)?.[0]?.avatarUrl;
}

function readDirectoryAvatar(
	queryClient: QueryClient
): string | null | undefined {
	return queryClient.getQueryData<{
		members: readonly { user: { image: string | null } }[];
	}>(organizationQueryKeys.directory("organization-1"))?.members[0]?.user.image;
}

function readSpaceMemberAvatar(
	queryClient: QueryClient
): string | null | undefined {
	return queryClient.getQueryData<{
		humans: readonly { avatarUrl?: string | null }[];
	}>(spaceQueryKeys.members("space-1", "human-profile-1"))?.humans[0]
		?.avatarUrl;
}

function readSpaceBootstrapMemberAvatar(
	queryClient: QueryClient
): string | null | undefined {
	return queryClient.getQueryData<{
		members: {
			humans: readonly { avatarUrl?: string | null }[];
		};
	}>(spaceQueryKeys.bootstrap("space-1", "human-profile-1"))?.members.humans[0]
		?.avatarUrl;
}
