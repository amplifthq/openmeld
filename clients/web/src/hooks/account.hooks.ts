import type {
	AccountAvatarResponse,
	AuthProfileView,
	OrganizationDirectoryResponse,
	SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import {
	type QueryClient,
	type QueryKey,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import type { AuthSession } from "#/lib/auth-client-types";
import { getFrontendCallbackURL } from "#/lib/auth-redirect";
import {
	changeUserPassword,
	generateOneTimeToken,
	linkSocialProvider,
	removeAccountAvatar,
	removePasskey,
	revokeOtherUserSessions,
	revokeSessionByToken,
	setUserPassword,
	unlinkAccountProvider,
	updateAccountAvatar,
	updateUserName,
} from "#/query/auth-query";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { startQueryKeys, userQueryKeys } from "#/query/query-keys";
import {
	accountAvatarQueryOptionsClient,
	listSessionsQueryOptionsClient,
	listUserAccountsQueryOptionsClient,
	sessionQueryOptionsClient,
	userPasskeysQueryOptionsClient,
} from "#/query/query-options";
import type { SpaceBootstrapSnapshot } from "#/query/spaces/bootstrap";
import { spaceQueryKeys } from "#/query/spaces/status";

export const useAccountSession = (input: { enabled?: boolean } = {}) =>
	useQuery({
		...sessionQueryOptionsClient(),
		enabled: input.enabled ?? true,
	});

export const useAccountAvatar = (input: { enabled?: boolean } = {}) =>
	useQuery({
		...accountAvatarQueryOptionsClient(),
		enabled: input.enabled ?? true,
	});

export const useAccountSessions = () =>
	useQuery({
		...listSessionsQueryOptionsClient(),
	});

export const useAccountLinkedProviders = () =>
	useQuery({
		...listUserAccountsQueryOptionsClient(),
	});

export const useAccountPasskeys = () =>
	useQuery({
		...userPasskeysQueryOptionsClient(),
	});

function useHasPasswordFromAccounts(): boolean {
	const { data: accounts = [] } = useAccountLinkedProviders();
	return accounts.some((account) => account.providerId === "credential");
}

export function useHasPassword(): boolean {
	return useHasPasswordFromAccounts();
}

async function invalidateAccountQueries(
	queryClient: ReturnType<typeof useQueryClient>
) {
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: userQueryKeys.session }),
		queryClient.invalidateQueries({ queryKey: userQueryKeys.listUserAccounts }),
		queryClient.invalidateQueries({ queryKey: userQueryKeys.passkeys }),
		queryClient.invalidateQueries({ queryKey: userQueryKeys.listSessions }),
	]);
}

export function useUpdateUserName() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: updateUserName,
		onSuccess: async () => await invalidateAccountIdentity(queryClient),
	});
}

export function useUpdateAccountAvatar(input: {
	defaultHumanProfileId: string;
}) {
	const queryClient = useQueryClient();

	return useMutation<
		AccountAvatarResponse,
		Error,
		UpdateAccountAvatarInput,
		AccountAvatarUpdateContext
	>({
		mutationFn: updateAccountAvatar,
		onSuccess: (response, _variables, context) => {
			setAccountAvatarIdentityProjection(queryClient, response);
			releaseOptimisticAvatarUrl(context?.optimisticAvatarUrl);
		},
		onError: (_error, _variables, context) => {
			restoreAccountAvatarIdentitySnapshot(queryClient, context?.snapshot);
			releaseOptimisticAvatarUrl(context?.optimisticAvatarUrl);
		},
		onMutate: async (variables) => {
			const snapshot = await captureAccountAvatarIdentitySnapshot(queryClient);
			const optimisticAvatarUrl = createOptimisticAvatarUrl(variables);
			if (optimisticAvatarUrl) {
				setAccountAvatarIdentityProjection(queryClient, {
					avatar: optimisticAvatarUrl,
					defaultHumanProfileId: input.defaultHumanProfileId,
				});
			}
			return { optimisticAvatarUrl, snapshot };
		},
		onSettled: async () => await invalidateAccountIdentity(queryClient),
	});
}

export function useRemoveAccountAvatar(input: {
	defaultHumanProfileId: string;
}) {
	const queryClient = useQueryClient();

	return useMutation<
		AccountAvatarResponse,
		Error,
		void,
		AccountAvatarRemoveContext
	>({
		mutationFn: removeAccountAvatar,
		onSuccess: (response) => {
			setAccountAvatarIdentityProjection(queryClient, response);
		},
		onError: (_error, _variables, context) =>
			restoreAccountAvatarIdentitySnapshot(queryClient, context?.snapshot),
		onMutate: async () => {
			const snapshot = await captureAccountAvatarIdentitySnapshot(queryClient);
			setAccountAvatarIdentityProjection(queryClient, {
				avatar: null,
				defaultHumanProfileId: input.defaultHumanProfileId,
			});
			return { snapshot };
		},
		onSettled: async () => await invalidateAccountIdentity(queryClient),
	});
}

type AccountAvatarIdentityProjection = Pick<
	AccountAvatarResponse,
	"avatar" | "defaultHumanProfileId"
>;

function setAccountAvatarIdentityProjection(
	queryClient: QueryClient,
	projection: AccountAvatarIdentityProjection
): void {
	queryClient.setQueryData<AccountAvatarResponse>(userQueryKeys.accountAvatar, {
		...projection,
		ok: true,
	});
	queryClient.setQueryData<AuthSession>(userQueryKeys.session, (session) => {
		if (!session) {
			return session;
		}
		return {
			...session,
			user: {
				...session.user,
				image: projection.avatar,
			},
		};
	});
	queryClient.setQueriesData<readonly AuthProfileView[]>(
		{ queryKey: startQueryKeys.allProfiles },
		(profiles) =>
			profiles?.map((profile) =>
				profile.openMeldProfileId === projection.defaultHumanProfileId
					? {
							...profile,
							avatarUrl: projection.avatar ?? undefined,
						}
					: profile
			)
	);
	queryClient.setQueriesData<OrganizationDirectoryResponse>(
		organizationDirectoryQueryFilters(),
		(directory) => {
			if (!directory) {
				return directory;
			}
			const members = directory.members.map((member) =>
				member.humanProfile?.profileId === projection.defaultHumanProfileId
					? {
							...member,
							user: {
								...member.user,
								image: projection.avatar,
							},
						}
					: member
			);
			return { ...directory, members };
		}
	);
	queryClient.setQueriesData<SpaceMembersSnapshot>(
		{ queryKey: spaceQueryKeys.allMembers },
		(members) =>
			members ? setSpaceHumanMemberAvatar(members, projection) : members
	);
	queryClient.setQueriesData<SpaceBootstrapSnapshot>(
		{ queryKey: spaceQueryKeys.allBootstraps },
		(bootstrap) =>
			bootstrap
				? {
						...bootstrap,
						members: setSpaceHumanMemberAvatar(bootstrap.members, projection),
					}
				: bootstrap
	);
}

async function invalidateAccountIdentity(
	queryClient: QueryClient
): Promise<void> {
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: userQueryKeys.accountAvatar }),
		queryClient.invalidateQueries({ queryKey: userQueryKeys.session }),
		queryClient.invalidateQueries({ queryKey: startQueryKeys.allProfiles }),
		queryClient.invalidateQueries({
			queryKey: startQueryKeys.allAccountProfiles,
		}),
		queryClient.invalidateQueries({
			queryKey: startQueryKeys.allHumanProfiles,
		}),
		queryClient.invalidateQueries({ queryKey: organizationQueryKeys.all }),
		queryClient.invalidateQueries({ queryKey: spaceQueryKeys.allMembers }),
		queryClient.invalidateQueries({
			queryKey: spaceQueryKeys.allBootstraps,
		}),
	]);
}

type AccountAvatarIdentitySnapshot = {
	accountAvatar: AccountAvatarResponse | undefined;
	directories: readonly [QueryKey, OrganizationDirectoryResponse | undefined][];
	profiles: readonly [QueryKey, readonly AuthProfileView[] | undefined][];
	session: AuthSession | undefined;
	spaceBootstraps: readonly [QueryKey, SpaceBootstrapSnapshot | undefined][];
	spaceMembers: readonly [QueryKey, SpaceMembersSnapshot | undefined][];
};

type AccountAvatarUpdateContext = {
	optimisticAvatarUrl: string | null;
	snapshot: AccountAvatarIdentitySnapshot;
};

type AccountAvatarRemoveContext = {
	snapshot: AccountAvatarIdentitySnapshot;
};

async function captureAccountAvatarIdentitySnapshot(
	queryClient: QueryClient
): Promise<AccountAvatarIdentitySnapshot> {
	await Promise.all([
		queryClient.cancelQueries({ queryKey: userQueryKeys.accountAvatar }),
		queryClient.cancelQueries({ queryKey: userQueryKeys.session }),
		queryClient.cancelQueries({ queryKey: startQueryKeys.allProfiles }),
		queryClient.cancelQueries(organizationDirectoryQueryFilters()),
		queryClient.cancelQueries({ queryKey: spaceQueryKeys.allMembers }),
		queryClient.cancelQueries({ queryKey: spaceQueryKeys.allBootstraps }),
	]);
	return {
		accountAvatar: queryClient.getQueryData<AccountAvatarResponse>(
			userQueryKeys.accountAvatar
		),
		directories: queryClient.getQueriesData<OrganizationDirectoryResponse>(
			organizationDirectoryQueryFilters()
		),
		profiles: queryClient.getQueriesData<readonly AuthProfileView[]>({
			queryKey: startQueryKeys.allProfiles,
		}),
		session: queryClient.getQueryData<AuthSession>(userQueryKeys.session),
		spaceBootstraps: queryClient.getQueriesData<SpaceBootstrapSnapshot>({
			queryKey: spaceQueryKeys.allBootstraps,
		}),
		spaceMembers: queryClient.getQueriesData<SpaceMembersSnapshot>({
			queryKey: spaceQueryKeys.allMembers,
		}),
	};
}

function restoreAccountAvatarIdentitySnapshot(
	queryClient: QueryClient,
	snapshot: AccountAvatarIdentitySnapshot | undefined
): void {
	if (!snapshot) {
		return;
	}
	queryClient.setQueryData(userQueryKeys.accountAvatar, snapshot.accountAvatar);
	queryClient.setQueryData(userQueryKeys.session, snapshot.session);
	for (const [queryKey, profiles] of snapshot.profiles) {
		queryClient.setQueryData(queryKey, profiles);
	}
	for (const [queryKey, directory] of snapshot.directories) {
		queryClient.setQueryData(queryKey, directory);
	}
	for (const [queryKey, members] of snapshot.spaceMembers) {
		queryClient.setQueryData(queryKey, members);
	}
	for (const [queryKey, bootstrap] of snapshot.spaceBootstraps) {
		queryClient.setQueryData(queryKey, bootstrap);
	}
}

function setSpaceHumanMemberAvatar(
	snapshot: SpaceMembersSnapshot,
	projection: AccountAvatarIdentityProjection
): SpaceMembersSnapshot {
	let changed = false;
	const humans = snapshot.humans.map((member) => {
		if (member.profileId !== projection.defaultHumanProfileId) {
			return member;
		}
		changed = true;
		return {
			...member,
			avatarUrl: projection.avatar,
		};
	});
	return changed ? { ...snapshot, humans } : snapshot;
}

function organizationDirectoryQueryFilters() {
	return {
		predicate: (query: { queryKey: QueryKey }) =>
			query.queryKey.length === 3 &&
			query.queryKey[0] === organizationQueryKeys.all[0] &&
			query.queryKey[2] === "directory",
		queryKey: organizationQueryKeys.all,
	};
}

type UpdateAccountAvatarInput = Parameters<typeof updateAccountAvatar>[0];

function createOptimisticAvatarUrl(
	input: UpdateAccountAvatarInput
): string | null {
	if (typeof URL.createObjectURL !== "function") {
		return null;
	}
	const bytes =
		input.bytes instanceof Uint8Array
			? Uint8Array.from(input.bytes).buffer
			: input.bytes;
	const image =
		bytes instanceof Blob
			? bytes
			: new Blob([bytes], {
					type: input.mimeType,
				});
	return URL.createObjectURL(image);
}

function releaseOptimisticAvatarUrl(url: string | null | undefined): void {
	if (url && typeof URL.revokeObjectURL === "function") {
		URL.revokeObjectURL(url);
	}
}

export function useChangePassword() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: changeUserPassword,
		onSuccess: async () => {
			await invalidateAccountQueries(queryClient);
		},
	});
}

export function useSetPassword() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: setUserPassword,
		onSuccess: async () => {
			await invalidateAccountQueries(queryClient);
		},
	});
}

export function useRevokeSession() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: revokeSessionByToken,
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: userQueryKeys.listSessions,
			});
			await queryClient.invalidateQueries({ queryKey: userQueryKeys.session });
		},
	});
}

export function useRevokeAllOtherSessions() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: revokeOtherUserSessions,
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: userQueryKeys.listSessions,
			});
			await queryClient.invalidateQueries({ queryKey: userQueryKeys.session });
		},
	});
}

export function useLinkSocialProvider() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (provider: "github" | "google") => {
			const currentPath =
				window.location.pathname.startsWith("/o/") &&
				window.location.pathname.includes("/settings/account")
					? `${window.location.pathname}${window.location.search}${window.location.hash}`
					: "/login";
			const callbackURL = new URL(
				getFrontendCallbackURL(currentPath),
				window.location.origin
			);
			callbackURL.searchParams.set("linking", "true");

			await linkSocialProvider({
				provider,
				callbackURL: callbackURL.toString(),
			});
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: userQueryKeys.listUserAccounts,
			});
		},
	});
}

export function useUnlinkSocialProvider() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: unlinkAccountProvider,
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: userQueryKeys.listUserAccounts,
			});
		},
	});
}

export function useRemovePasskey() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: removePasskey,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: userQueryKeys.passkeys });
		},
	});
}

export function useGenerateOneTimeToken() {
	return useMutation({
		mutationFn: generateOneTimeToken,
	});
}

export function useCanUnlinkProvider(providerId: string) {
	const { data: linkedAccounts = [] } = useAccountLinkedProviders();
	const { data: passkeys = [] } = useAccountPasskeys();

	const hasPassword = linkedAccounts.some(
		(account) => account.providerId === "credential"
	);
	const hasPasskeys = passkeys.length > 0;
	const hasOtherOAuth = linkedAccounts.some(
		(account) =>
			account.providerId !== providerId && account.providerId !== "credential"
	);

	const canUnlink = hasPassword || hasPasskeys || hasOtherOAuth;
	const suggestedActions: string[] = [];
	if (!hasPassword) {
		suggestedActions.push("set up a password");
	}
	if (!hasPasskeys) {
		suggestedActions.push("add a passkey");
	}
	if (!hasOtherOAuth) {
		suggestedActions.push("link another social account");
	}

	const warningMessage = canUnlink
		? null
		: `To unlink this account, please ${suggestedActions.join(" or ")} first.`;

	return {
		canUnlink,
		hasPassword,
		hasPasskeys,
		hasOtherOAuth,
		totalAuthMethods:
			(hasPassword ? 1 : 0) + passkeys.length + linkedAccounts.length,
		suggestedActions,
		warningMessage,
	};
}
