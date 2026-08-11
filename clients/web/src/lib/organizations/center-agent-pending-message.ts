import type { QueryClient } from "@tanstack/react-query";
import type { PendingSpaceMessage } from "#/lib/spaces/pending-message";

export type PendingCenterAgentMessage = PendingSpaceMessage;

export type CenterAgentPendingMessageScope = {
	organizationId?: string;
	organizationSlug: string;
};

const centerAgentPendingMessageKeys = {
	all: ["center-agent", "pending-message"] as const,
	activeScope: ["center-agent", "pending-message-scope"] as const,
	byScope: (scope: CenterAgentPendingMessageScope) =>
		[
			...centerAgentPendingMessageKeys.all,
			scope.organizationId ? "organization-id" : "organization-slug",
			scope.organizationId ?? scope.organizationSlug,
		] as const,
};

export function createPendingCenterAgentMessage(
	text: string
): PendingCenterAgentMessage {
	if (!globalThis.crypto?.randomUUID) {
		throw new Error("Browser crypto.randomUUID is required to send messages.");
	}

	return {
		clientMessageId: globalThis.crypto.randomUUID(),
		createdAtMs: Date.now(),
		text,
	};
}

export function activateCenterAgentPendingMessageScope(
	queryClient: QueryClient,
	scope: CenterAgentPendingMessageScope
): void {
	const normalizedScope = normalizePendingMessageScope(scope);
	const activeScope = queryClient.getQueryData<CenterAgentPendingMessageScope>(
		centerAgentPendingMessageKeys.activeScope
	);

	if (!activeScope) {
		queryClient.setQueryData(
			centerAgentPendingMessageKeys.activeScope,
			normalizedScope
		);
		return;
	}

	if (!isSamePendingMessageScope(activeScope, normalizedScope)) {
		queryClient.removeQueries({
			queryKey: centerAgentPendingMessageKeys.all,
		});
		queryClient.setQueryData(
			centerAgentPendingMessageKeys.activeScope,
			normalizedScope
		);
		return;
	}

	const pendingMessage = readCenterAgentPendingMessage(
		queryClient,
		activeScope
	);
	queryClient.setQueryData(
		centerAgentPendingMessageKeys.activeScope,
		normalizedScope
	);
	if (pendingMessage) {
		queryClient.setQueryData(
			centerAgentPendingMessageKeys.byScope(normalizedScope),
			pendingMessage
		);
		if (activeScope.organizationId !== normalizedScope.organizationId) {
			queryClient.removeQueries({
				exact: true,
				queryKey: centerAgentPendingMessageKeys.byScope(activeScope),
			});
		}
	}
}

export function readCenterAgentPendingMessage(
	queryClient: QueryClient,
	scope: CenterAgentPendingMessageScope
): PendingCenterAgentMessage | null {
	const normalizedScope = normalizePendingMessageScope(scope);
	const directMessage = queryClient.getQueryData<PendingCenterAgentMessage>(
		centerAgentPendingMessageKeys.byScope(normalizedScope)
	);
	if (directMessage) {
		return directMessage;
	}

	const activeScope = queryClient.getQueryData<CenterAgentPendingMessageScope>(
		centerAgentPendingMessageKeys.activeScope
	);
	if (
		!(activeScope && isSamePendingMessageScope(activeScope, normalizedScope))
	) {
		return null;
	}

	return (
		queryClient.getQueryData<PendingCenterAgentMessage>(
			centerAgentPendingMessageKeys.byScope(activeScope)
		) ?? null
	);
}

export function writeCenterAgentPendingMessage(
	queryClient: QueryClient,
	scope: CenterAgentPendingMessageScope,
	message: PendingCenterAgentMessage
): void {
	const normalizedScope = normalizePendingMessageScope(scope);
	activateCenterAgentPendingMessageScope(queryClient, normalizedScope);
	queryClient.setQueryData(
		centerAgentPendingMessageKeys.byScope(normalizedScope),
		message
	);
}

export function clearCenterAgentPendingMessage(
	queryClient: QueryClient,
	scope: CenterAgentPendingMessageScope
): void {
	const normalizedScope = normalizePendingMessageScope(scope);
	queryClient.removeQueries({
		exact: true,
		queryKey: centerAgentPendingMessageKeys.byScope(normalizedScope),
	});
	const activeScope = queryClient.getQueryData<CenterAgentPendingMessageScope>(
		centerAgentPendingMessageKeys.activeScope
	);
	if (activeScope && isSamePendingMessageScope(activeScope, normalizedScope)) {
		queryClient.removeQueries({
			exact: true,
			queryKey: centerAgentPendingMessageKeys.byScope(activeScope),
		});
	}
}

function normalizePendingMessageScope(
	scope: CenterAgentPendingMessageScope
): CenterAgentPendingMessageScope {
	const organizationSlug = scope.organizationSlug.trim();
	if (!organizationSlug) {
		throw new Error(
			"Center Agent pending message scope requires an organization slug."
		);
	}
	const organizationId = scope.organizationId?.trim();
	return {
		organizationSlug,
		...(organizationId ? { organizationId } : {}),
	};
}

function isSamePendingMessageScope(
	left: CenterAgentPendingMessageScope,
	right: CenterAgentPendingMessageScope
): boolean {
	if (left.organizationId && right.organizationId) {
		return left.organizationId === right.organizationId;
	}
	return left.organizationSlug === right.organizationSlug;
}
