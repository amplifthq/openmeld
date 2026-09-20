import {
	createComputerAuthorizationGrant as createSharedComputerAuthorizationGrant,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import {
	ACCOUNT_AVATAR_MAX_SIZE_BYTES,
	ACCOUNT_AVATAR_ROUTE,
	accountAvatarMimeTypeSchema,
	accountAvatarResponseSchema,
	updateAccountDisplayNameBodySchema,
	updateAccountDisplayNameResponseSchema,
} from "@openmeld/schemas";
import type {
	AccountAvatarMimeType,
	AccountAvatarResponse,
	UpdateAccountDisplayNameResponse,
} from "@openmeld/schemas/types";
import { readCurrentAccountSession } from "#/lib/account-session";
import { openMeldAuthClient } from "#/lib/auth-client";
import type {
	AuthAccount,
	AuthClientError,
	AuthDeviceSession,
	AuthPasskey,
	AuthSessionRecord,
} from "#/lib/auth-client-types";
import { getAuthErrorMessage } from "#/lib/auth-errors";
import { requestAuthEndpoint, resolveClientResult } from "#/lib/auth-transport";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import {
	isSessionExpiredError,
	SessionExpiredError,
} from "#/lib/session-expired";

type ChangePasswordInput = {
	currentPassword: string;
	newPassword: string;
	revokeOtherSessions: boolean;
};

type LinkSocialProviderInput = {
	provider: "github" | "google";
	callbackURL: string;
};

type OneTimeTokenPayload = {
	token: string;
	expiresIn?: number;
};

export type ComputerAuthorizationGrant = {
	deviceCode: string;
	expiresIn?: number;
};

type AuthClientWithAccountApi = {
	listAccounts?: () => Promise<unknown>;
	listSessions?: () => Promise<unknown>;
	changePassword?: (input: ChangePasswordInput) => Promise<unknown>;
	revokeSession?: (input: { token: string }) => Promise<unknown>;
	revokeOtherSessions?: () => Promise<unknown>;
	linkSocial?: (input: LinkSocialProviderInput) => Promise<unknown>;
	unlinkAccount?: (input: { providerId: string }) => Promise<unknown>;
	passkey?: {
		listUserPasskeys?: () => Promise<unknown>;
		deletePasskey?: (input: { id: string }) => Promise<unknown>;
		removePasskey?: (input: { id: string }) => Promise<unknown>;
	};
};

const authClientWithAccountApi =
	openMeldAuthClient as unknown as AuthClientWithAccountApi;

function isUnauthorizedError(error: AuthClientError | null): boolean {
	return isSessionExpiredError(error);
}

function throwAuthError(
	error: AuthClientError | null,
	fallback: string
): never {
	if (isSessionExpiredError(error)) {
		throw new SessionExpiredError({
			cause: error,
			statusText: error?.statusText,
		});
	}

	throw new Error(getAuthErrorMessage(error, fallback));
}

export const getSession = readCurrentAccountSession;

export async function listAccounts(): Promise<AuthAccount[]> {
	if (!authClientWithAccountApi.listAccounts) {
		const fallbackResponse = await requestAuthEndpoint<AuthAccount[]>({
			path: "/list-accounts",
			request: { method: "GET" },
			fallbackMessage: "Failed to fetch linked accounts.",
		});
		if (fallbackResponse.error) {
			if (isUnauthorizedError(fallbackResponse.error)) {
				return [];
			}
			throwAuthError(
				fallbackResponse.error,
				"Failed to fetch linked accounts."
			);
		}
		return Array.isArray(fallbackResponse.data) ? fallbackResponse.data : [];
	}

	const response = await resolveClientResult<AuthAccount[] | null>(
		() => authClientWithAccountApi.listAccounts?.(),
		"Failed to fetch linked accounts."
	);

	if (response.error) {
		if (isUnauthorizedError(response.error)) {
			return [];
		}
		throwAuthError(response.error, "Failed to fetch linked accounts.");
	}

	return Array.isArray(response.data) ? response.data : [];
}

export async function listUserPasskeys(): Promise<AuthPasskey[]> {
	if (!authClientWithAccountApi.passkey?.listUserPasskeys) {
		const fallbackResponse = await requestAuthEndpoint<AuthPasskey[]>({
			path: "/passkey/list-user-passkeys",
			request: { method: "GET" },
			fallbackMessage: "Failed to fetch passkeys.",
		});
		if (fallbackResponse.error) {
			if (isUnauthorizedError(fallbackResponse.error)) {
				return [];
			}
			throwAuthError(fallbackResponse.error, "Failed to fetch passkeys.");
		}
		return Array.isArray(fallbackResponse.data) ? fallbackResponse.data : [];
	}

	const response = await resolveClientResult<AuthPasskey[] | null>(
		() => authClientWithAccountApi.passkey?.listUserPasskeys?.(),
		"Failed to fetch passkeys."
	);

	if (response.error) {
		if (isUnauthorizedError(response.error)) {
			return [];
		}
		throwAuthError(response.error, "Failed to fetch passkeys.");
	}

	return Array.isArray(response.data) ? response.data : [];
}

export async function listSessions(): Promise<AuthSessionRecord[]> {
	if (authClientWithAccountApi.listSessions) {
		const response = await resolveClientResult<AuthSessionRecord[] | null>(
			() => authClientWithAccountApi.listSessions?.(),
			"Failed to fetch sessions."
		);

		if (response.error) {
			if (isUnauthorizedError(response.error)) {
				return [];
			}
			throwAuthError(response.error, "Failed to fetch sessions.");
		}

		return Array.isArray(response.data) ? response.data : [];
	}

	const fallbackResponse = await requestAuthEndpoint<AuthSessionRecord[]>({
		path: "/list-sessions",
		request: { method: "GET" },
		fallbackMessage: "Failed to fetch sessions.",
	});

	if (fallbackResponse.error) {
		if (isUnauthorizedError(fallbackResponse.error)) {
			return [];
		}
		throwAuthError(fallbackResponse.error, "Failed to fetch sessions.");
	}

	return Array.isArray(fallbackResponse.data) ? fallbackResponse.data : [];
}

export async function listDeviceSessions(): Promise<AuthDeviceSession[]> {
	const response = await resolveClientResult<AuthDeviceSession[] | null>(
		() => openMeldAuthClient.multiSession.listDeviceSessions(),
		"Unable to load accounts."
	);

	if (response.error) {
		throwAuthError(response.error, "Unable to load accounts.");
	}

	return Array.isArray(response.data) ? response.data : [];
}

export async function setActiveDeviceSession(
	sessionToken: string
): Promise<void> {
	const response = await resolveClientResult(
		() => openMeldAuthClient.multiSession.setActive({ sessionToken }),
		"Unable to switch accounts."
	);

	if (response.error) {
		throwAuthError(response.error, "Unable to switch accounts.");
	}
}

export async function revokeDeviceSession(sessionToken: string): Promise<void> {
	const response = await resolveClientResult(
		() => openMeldAuthClient.multiSession.revoke({ sessionToken }),
		"Unable to log out of this account."
	);

	if (response.error) {
		throwAuthError(response.error, "Unable to log out of this account.");
	}
}

export async function updateUserName(
	name: string
): Promise<UpdateAccountDisplayNameResponse> {
	const parsedBody = updateAccountDisplayNameBodySchema.safeParse({
		displayName: name,
	});
	if (!parsedBody.success) {
		throw new Error(
			parsedBody.error.issues[0]?.message ?? "Display name is invalid."
		);
	}

	try {
		return await createUnscopedWebOpenMeldApiFoundation().requestJson({
			body: JSON.stringify(parsedBody.data),
			headers: {
				"content-type": "application/json",
			},
			invalidMessage: "Invalid Account Display Name response.",
			method: "PATCH",
			operation: "account.displayName.update",
			schema: updateAccountDisplayNameResponseSchema,
			url: "/v1/account/display-name",
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function updateAccountAvatar(input: {
	bytes: ArrayBuffer | Blob | Uint8Array;
	mimeType: AccountAvatarMimeType;
}): Promise<AccountAvatarResponse> {
	const mimeType = accountAvatarMimeTypeSchema.parse(input.mimeType);
	const body = toAccountAvatarBody(input.bytes);
	const sizeBytes = body instanceof Blob ? body.size : body.byteLength;
	if (sizeBytes < 1 || sizeBytes > ACCOUNT_AVATAR_MAX_SIZE_BYTES) {
		throw new Error("Choose an image that is 5 MB or smaller.");
	}

	try {
		return await createUnscopedWebOpenMeldApiFoundation().requestJson({
			body,
			headers: { "content-type": mimeType },
			invalidMessage: "Invalid Account avatar response.",
			method: "PUT",
			operation: "account.avatar.update",
			schema: accountAvatarResponseSchema,
			url: ACCOUNT_AVATAR_ROUTE,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function getAccountAvatar(): Promise<AccountAvatarResponse> {
	try {
		return await createUnscopedWebOpenMeldApiFoundation().requestJson({
			invalidMessage: "Invalid Account avatar response.",
			method: "GET",
			operation: "account.avatar.read",
			schema: accountAvatarResponseSchema,
			url: ACCOUNT_AVATAR_ROUTE,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function removeAccountAvatar(): Promise<AccountAvatarResponse> {
	try {
		return await createUnscopedWebOpenMeldApiFoundation().requestJson({
			invalidMessage: "Invalid Account avatar response.",
			method: "DELETE",
			operation: "account.avatar.remove",
			schema: accountAvatarResponseSchema,
			url: ACCOUNT_AVATAR_ROUTE,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function changeUserPassword(
	input: ChangePasswordInput
): Promise<void> {
	if (authClientWithAccountApi.changePassword) {
		const response = await resolveClientResult(
			() => authClientWithAccountApi.changePassword?.(input),
			"Failed to change password."
		);
		if (response.error) {
			throwAuthError(response.error, "Failed to change password.");
		}
		return;
	}

	const fallbackResponse = await requestAuthEndpoint({
		path: "/change-password",
		request: {
			method: "POST",
			body: JSON.stringify(input),
		},
		fallbackMessage: "Failed to change password.",
	});

	if (fallbackResponse.error) {
		throwAuthError(fallbackResponse.error, "Failed to change password.");
	}
}

export async function setUserPassword(newPassword: string): Promise<void> {
	// Better Auth documents setPassword as a server-side operation.
	// Always go through our auth-worker bridge route to avoid client-side 404s.
	const fallbackResponse = await requestAuthEndpoint({
		path: "/set-password",
		request: {
			method: "POST",
			body: JSON.stringify({ newPassword }),
		},
		fallbackMessage: "Failed to set password.",
	});

	if (fallbackResponse.error) {
		throwAuthError(fallbackResponse.error, "Failed to set password.");
	}
}

function toAccountAvatarBody(
	bytes: ArrayBuffer | Blob | Uint8Array
): ArrayBuffer | Blob {
	if (bytes instanceof Blob || bytes instanceof ArrayBuffer) {
		return bytes;
	}
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

export async function revokeSessionByToken(token: string): Promise<void> {
	if (authClientWithAccountApi.revokeSession) {
		const response = await resolveClientResult(
			() => authClientWithAccountApi.revokeSession?.({ token }),
			"Failed to revoke session."
		);
		if (response.error) {
			throwAuthError(response.error, "Failed to revoke session.");
		}
		return;
	}

	const fallbackResponse = await requestAuthEndpoint({
		path: "/revoke-session",
		request: {
			method: "POST",
			body: JSON.stringify({ token }),
		},
		fallbackMessage: "Failed to revoke session.",
	});

	if (fallbackResponse.error) {
		throwAuthError(fallbackResponse.error, "Failed to revoke session.");
	}
}

export async function revokeOtherUserSessions(): Promise<void> {
	if (authClientWithAccountApi.revokeOtherSessions) {
		const response = await resolveClientResult(
			() => authClientWithAccountApi.revokeOtherSessions?.(),
			"Failed to revoke other sessions."
		);
		if (response.error) {
			throwAuthError(response.error, "Failed to revoke other sessions.");
		}
		return;
	}

	const fallbackResponse = await requestAuthEndpoint({
		path: "/revoke-other-sessions",
		request: {
			method: "POST",
			body: JSON.stringify({}),
		},
		fallbackMessage: "Failed to revoke other sessions.",
	});

	if (fallbackResponse.error) {
		throwAuthError(fallbackResponse.error, "Failed to revoke other sessions.");
	}
}

export async function linkSocialProvider(
	input: LinkSocialProviderInput
): Promise<void> {
	if (authClientWithAccountApi.linkSocial) {
		const response = await resolveClientResult(
			() => authClientWithAccountApi.linkSocial?.(input),
			`Failed to link ${input.provider}.`
		);
		if (response.error) {
			throwAuthError(response.error, `Failed to link ${input.provider}.`);
		}
		return;
	}

	const fallbackResponse = await requestAuthEndpoint({
		path: "/link-social",
		request: {
			method: "POST",
			body: JSON.stringify(input),
		},
		fallbackMessage: `Failed to link ${input.provider}.`,
	});

	if (fallbackResponse.error) {
		throwAuthError(fallbackResponse.error, `Failed to link ${input.provider}.`);
	}
}

export async function unlinkAccountProvider(providerId: string): Promise<void> {
	if (authClientWithAccountApi.unlinkAccount) {
		const response = await resolveClientResult(
			() => authClientWithAccountApi.unlinkAccount?.({ providerId }),
			`Failed to unlink ${providerId}.`
		);
		if (response.error) {
			throwAuthError(response.error, `Failed to unlink ${providerId}.`);
		}
		return;
	}

	const fallbackResponse = await requestAuthEndpoint({
		path: "/unlink-account",
		request: {
			method: "POST",
			body: JSON.stringify({ providerId }),
		},
		fallbackMessage: `Failed to unlink ${providerId}.`,
	});

	if (fallbackResponse.error) {
		throwAuthError(fallbackResponse.error, `Failed to unlink ${providerId}.`);
	}
}

export async function removePasskey(passkeyId: string): Promise<void> {
	const passkeyClient = authClientWithAccountApi.passkey;
	const removePasskeyMethod =
		passkeyClient?.deletePasskey ?? passkeyClient?.removePasskey;

	if (removePasskeyMethod) {
		const response = await resolveClientResult(
			() => removePasskeyMethod({ id: passkeyId }),
			"Failed to remove passkey."
		);
		if (response.error) {
			throwAuthError(response.error, "Failed to remove passkey.");
		}
		return;
	}

	const fallbackResponse = await requestAuthEndpoint({
		path: "/passkey/delete-passkey",
		request: {
			method: "POST",
			body: JSON.stringify({ id: passkeyId }),
		},
		fallbackMessage: "Failed to remove passkey.",
	});

	if (fallbackResponse.error) {
		throwAuthError(fallbackResponse.error, "Failed to remove passkey.");
	}
}

export async function generateOneTimeToken(): Promise<OneTimeTokenPayload> {
	const response = await requestAuthEndpoint<{
		token?: string;
		expiresIn?: number;
	}>({
		path: "/one-time-token/generate?disableCookieCache=true",
		request: { method: "GET" },
		fallbackMessage: "Failed to generate one-time token.",
	});

	if (response.error) {
		throwAuthError(response.error, "Failed to generate one-time token.");
	}

	const token = response.data?.token;
	if (typeof token !== "string" || token.length === 0) {
		throw new Error("Auth response did not include one-time token.");
	}

	return {
		token,
		expiresIn:
			typeof response.data?.expiresIn === "number"
				? response.data.expiresIn
				: undefined,
	};
}

export async function createComputerAuthorizationGrant(): Promise<ComputerAuthorizationGrant> {
	return await createSharedComputerAuthorizationGrant(
		async (path, method, body) => {
			const response = await requestAuthEndpoint<unknown>({
				path,
				request: { method, ...(body ? { body: JSON.stringify(body) } : {}) },
				fallbackMessage: "Failed to authorize this computer.",
			});
			if (response.error) {
				throwAuthError(response.error, "Failed to authorize this computer.");
			}
			return response.data;
		}
	);
}
