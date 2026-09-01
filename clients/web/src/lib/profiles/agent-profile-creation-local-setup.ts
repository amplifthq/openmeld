import type { AgentProfileCreationRequest } from "@openmeld/schemas/types";
import { configureNewAgentProfileWorkspace } from "./create-profile-flow";

const DRAFT_STORAGE_PREFIX =
	"openmeld:agent-profile-creation-local-setup-draft:v1";
const MARKER_STORAGE_PREFIX =
	"openmeld:agent-profile-creation-custom-folder-marker:v1";
const PROFILE_ID_PENDING_MARKER = "profile_identity_pending";

export type PendingAgentProfileCreationLocalSetup = {
	agentProfileId: string | null;
	workspacePath: string | null;
};

export function rememberPendingAgentProfileCreationLocalSetup(input: {
	agentProfileId: string | null;
	organizationId: string;
	requestId: string;
	storageScope: string;
	workspacePath: string;
}): boolean {
	if (typeof window === "undefined") {
		return false;
	}
	const pendingSetup = normalizePendingSetup(input);
	if (!pendingSetup) {
		return false;
	}
	let markerStored = false;
	try {
		window.localStorage.setItem(
			buildStorageKey(input, MARKER_STORAGE_PREFIX),
			pendingSetup.agentProfileId ?? PROFILE_ID_PENDING_MARKER
		);
		markerStored = true;
	} catch {
		// The per-tab path draft can still finish during the current tab.
	}
	try {
		window.sessionStorage.setItem(
			buildStorageKey(input, DRAFT_STORAGE_PREFIX),
			JSON.stringify(pendingSetup)
		);
	} catch {
		// The non-path marker keeps later presentation fail-closed.
	}
	return markerStored;
}

export function readPendingAgentProfileCreationLocalSetup(input: {
	organizationId: string;
	requestId: string;
	storageScope: string;
}): PendingAgentProfileCreationLocalSetup | null {
	if (typeof window === "undefined") {
		return null;
	}
	const draftStorageKey = buildStorageKey(input, DRAFT_STORAGE_PREFIX);
	const markerStorageKey = buildStorageKey(input, MARKER_STORAGE_PREFIX);
	try {
		const rawValue = window.sessionStorage.getItem(draftStorageKey);
		if (rawValue) {
			const pendingSetup = parsePendingSetup(rawValue);
			if (pendingSetup) {
				return pendingSetup;
			}
			window.sessionStorage.removeItem(draftStorageKey);
		}
	} catch {
		// The non-path marker can still preserve the incomplete state.
	}
	try {
		const markerValue =
			window.localStorage.getItem(markerStorageKey)?.trim() ?? "";
		if (markerValue) {
			return {
				agentProfileId:
					markerValue === PROFILE_ID_PENDING_MARKER ? null : markerValue,
				workspacePath: null,
			};
		}
	} catch {
		// Browser storage is unavailable, so no durable local setup intent exists.
	}
	return null;
}

export async function continuePendingAgentProfileCreationLocalSetup(input: {
	organizationId: string;
	pendingSetup?: PendingAgentProfileCreationLocalSetup;
	request: AgentProfileCreationRequest;
	selectedHumanProfileId: string | null;
	storageScope: string;
}): Promise<{ failureMessage: string | null; pending: boolean }> {
	const pendingSetup =
		input.pendingSetup ??
		readPendingAgentProfileCreationLocalSetup({
			organizationId: input.organizationId,
			requestId: input.request.id,
			storageScope: input.storageScope,
		});
	if (!pendingSetup) {
		return { failureMessage: null, pending: false };
	}
	if (
		input.request.status !== "completed" ||
		!input.request.createdAgentProfileId
	) {
		return { failureMessage: null, pending: true };
	}
	const createdAgentProfileId = input.request.createdAgentProfileId;
	if (
		pendingSetup.agentProfileId &&
		createdAgentProfileId !== pendingSetup.agentProfileId
	) {
		return {
			failureMessage:
				"OpenMeld couldn't match the saved working folder to the created Agent.",
			pending: true,
		};
	}
	if (!pendingSetup.workspacePath) {
		rememberCommittedAgentProfileMarker({
			agentProfileId: createdAgentProfileId,
			organizationId: input.organizationId,
			requestId: input.request.id,
			storageScope: input.storageScope,
		});
		return {
			failureMessage:
				"Choose the custom working folder again in Agent settings on this computer.",
			pending: true,
		};
	}
	rememberPendingAgentProfileCreationLocalSetup({
		agentProfileId: createdAgentProfileId,
		organizationId: input.organizationId,
		requestId: input.request.id,
		storageScope: input.storageScope,
		workspacePath: pendingSetup.workspacePath,
	});
	try {
		await configureNewAgentProfileWorkspace({
			agentProfileId: createdAgentProfileId,
			bindingEstablished: true,
			organizationId: input.organizationId,
			projectFolderPath: pendingSetup.workspacePath,
			selectedHumanProfileId: input.selectedHumanProfileId,
		});
	} catch (error) {
		return {
			failureMessage: readErrorMessage(error),
			pending: true,
		};
	}
	clearPendingAgentProfileCreationLocalSetup({
		organizationId: input.organizationId,
		requestId: input.request.id,
		storageScope: input.storageScope,
	});
	return { failureMessage: null, pending: false };
}

export function clearPendingAgentProfileCreationLocalSetupForProfile(
	agentProfileId: string
): void {
	if (typeof window === "undefined") {
		return;
	}
	const normalizedAgentProfileId = agentProfileId.trim();
	if (!normalizedAgentProfileId) {
		return;
	}
	clearMatchingStorageEntries({
		matches: (rawValue) => rawValue.trim() === normalizedAgentProfileId,
		prefix: MARKER_STORAGE_PREFIX,
		storage: window.localStorage,
	});
	clearMatchingStorageEntries({
		matches: (rawValue) =>
			parsePendingSetup(rawValue)?.agentProfileId === normalizedAgentProfileId,
		prefix: DRAFT_STORAGE_PREFIX,
		storage: window.sessionStorage,
	});
}

function clearPendingAgentProfileCreationLocalSetup(input: {
	organizationId: string;
	requestId: string;
	storageScope: string;
}): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.sessionStorage.removeItem(
			buildStorageKey(input, DRAFT_STORAGE_PREFIX)
		);
	} catch {
		// Ignore disabled per-tab storage after the Service accepted the write.
	}
	try {
		window.localStorage.removeItem(
			buildStorageKey(input, MARKER_STORAGE_PREFIX)
		);
	} catch {
		// A stale non-path marker remains fail-closed instead of changing workspace.
	}
}

function buildStorageKey(
	input: {
		organizationId: string;
		requestId: string;
		storageScope: string;
	},
	prefix: string
): string {
	return [prefix, input.storageScope, input.organizationId, input.requestId]
		.map((part) => encodeURIComponent(part.trim()))
		.join(":");
}

function rememberCommittedAgentProfileMarker(input: {
	agentProfileId: string;
	organizationId: string;
	requestId: string;
	storageScope: string;
}): void {
	try {
		window.localStorage.setItem(
			buildStorageKey(input, MARKER_STORAGE_PREFIX),
			input.agentProfileId
		);
	} catch {
		// The existing marker remains fail-closed if durable storage is unavailable.
	}
}

function clearMatchingStorageEntries(input: {
	matches: (rawValue: string) => boolean;
	prefix: string;
	storage: Storage;
}): void {
	try {
		const encodedPrefix = `${encodeURIComponent(input.prefix)}:`;
		for (let index = input.storage.length - 1; index >= 0; index -= 1) {
			const key = input.storage.key(index);
			if (!key?.startsWith(encodedPrefix)) {
				continue;
			}
			const rawValue = input.storage.getItem(key);
			if (rawValue !== null && input.matches(rawValue)) {
				input.storage.removeItem(key);
			}
		}
	} catch {
		// Disabled browser storage cannot be cleaned up from this page.
	}
}

function normalizePendingSetup(input: {
	agentProfileId: string | null;
	workspacePath: string;
}): PendingAgentProfileCreationLocalSetup | null {
	const agentProfileId = input.agentProfileId?.trim() || null;
	if (!input.workspacePath.trim()) {
		return null;
	}
	return { agentProfileId, workspacePath: input.workspacePath };
}

function parsePendingSetup(
	rawValue: string
): PendingAgentProfileCreationLocalSetup | null {
	try {
		const value = JSON.parse(rawValue) as unknown;
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return null;
		}
		const record = value as Record<string, unknown>;
		if (
			(record.agentProfileId !== null &&
				typeof record.agentProfileId !== "string") ||
			typeof record.workspacePath !== "string"
		) {
			return null;
		}
		return normalizePendingSetup({
			agentProfileId: record.agentProfileId,
			workspacePath: record.workspacePath,
		});
	} catch {
		return null;
	}
}

function readErrorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message.trim() : "";
	return (
		message || "OpenMeld couldn't set the working folder on this computer."
	);
}
