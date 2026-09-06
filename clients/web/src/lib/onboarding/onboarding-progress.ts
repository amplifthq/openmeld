import { buildOrganizationDefaultPath } from "#/lib/organizations/organization-routes";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";

export const OPENMELD_ONBOARDING_VERSION = 1;

export const OPENMELD_ONBOARDING_STEPS = [
	"organization",
	"channels",
	"plugins",
	"local-agents",
	"setup",
	"invite",
	"complete",
] as const;

export type OpenMeldOnboardingStep = (typeof OPENMELD_ONBOARDING_STEPS)[number];

const PERSONAL_ONBOARDING_STEPS = [
	"organization",
	"plugins",
	"local-agents",
	"complete",
] as const satisfies readonly OpenMeldOnboardingStep[];

export type OpenMeldOnboardingProgress = {
	completedAtMs: number | null;
	currentStep: OpenMeldOnboardingStep;
	returnTo: string | null;
	selectedOrganizationId: string | null;
	updatedAtMs: number;
	version: typeof OPENMELD_ONBOARDING_VERSION;
};

const STORAGE_KEY_PREFIX = "openmeld:onboarding";
const ORGANIZATION_PATH_PREFIX_PATTERN = /^\/o\/[^/]+(?=\/|$)/u;
const inMemoryProgressByStorageKey = new Map<
	string,
	OpenMeldOnboardingProgress
>();

export function buildOnboardingStorageKey(storageScope: string): string {
	return `${STORAGE_KEY_PREFIX}:${storageScope}:v${OPENMELD_ONBOARDING_VERSION}`;
}

export function createInitialOnboardingProgress(input?: {
	nowMs?: number;
	returnTo?: string | null;
}): OpenMeldOnboardingProgress {
	return {
		completedAtMs: null,
		currentStep: "organization",
		returnTo: normalizeReturnPath(input?.returnTo),
		selectedOrganizationId: null,
		updatedAtMs: input?.nowMs ?? Date.now(),
		version: OPENMELD_ONBOARDING_VERSION,
	};
}

export function readOnboardingProgress(input: {
	storage: Pick<Storage, "getItem">;
	storageScope: string;
}): OpenMeldOnboardingProgress | null {
	const storageKey = buildOnboardingStorageKey(input.storageScope);
	let raw: string | null;
	try {
		raw = input.storage.getItem(storageKey);
	} catch (error) {
		reportOnboardingStorageFailure({
			error,
			operation: "read",
			storageScope: input.storageScope,
		});
		return inMemoryProgressByStorageKey.get(storageKey) ?? null;
	}
	if (!raw) {
		return inMemoryProgressByStorageKey.get(storageKey) ?? null;
	}
	try {
		const value: unknown = JSON.parse(raw);
		if (!isOnboardingProgress(value)) {
			inMemoryProgressByStorageKey.delete(storageKey);
			return null;
		}
		inMemoryProgressByStorageKey.set(storageKey, value);
		return value;
	} catch {
		inMemoryProgressByStorageKey.delete(storageKey);
		return null;
	}
}

export function writeOnboardingProgress(input: {
	progress: OpenMeldOnboardingProgress;
	storage: Pick<Storage, "setItem">;
	storageScope: string;
}): void {
	const storageKey = buildOnboardingStorageKey(input.storageScope);
	inMemoryProgressByStorageKey.set(storageKey, input.progress);
	try {
		input.storage.setItem(storageKey, JSON.stringify(input.progress));
	} catch (error) {
		reportOnboardingStorageFailure({
			error,
			operation: "write",
			storageScope: input.storageScope,
		});
	}
}

export function advanceOnboardingProgress(input: {
	current: OpenMeldOnboardingProgress;
	nowMs?: number;
	selectedOrganizationId?: string | null;
	step: OpenMeldOnboardingStep;
}): OpenMeldOnboardingProgress {
	return {
		...input.current,
		currentStep: input.step,
		selectedOrganizationId:
			input.selectedOrganizationId === undefined
				? input.current.selectedOrganizationId
				: input.selectedOrganizationId,
		updatedAtMs: input.nowMs ?? Date.now(),
	};
}

export function resolveOnboardingResumeTarget(input: {
	currentOrganization: OrganizationSummary;
	nowMs?: number;
	organizations: readonly OrganizationSummary[];
	progress: OpenMeldOnboardingProgress;
}): {
	organization: OrganizationSummary;
	progress: OpenMeldOnboardingProgress;
} {
	if (!input.progress.selectedOrganizationId) {
		return {
			organization: input.currentOrganization,
			progress: input.progress,
		};
	}
	const selectedOrganization = input.organizations.find(
		(organization) => organization.id === input.progress.selectedOrganizationId
	);
	if (selectedOrganization) {
		return {
			organization: selectedOrganization,
			progress: input.progress,
		};
	}
	return {
		organization: input.currentOrganization,
		progress: advanceOnboardingProgress({
			current: input.progress,
			nowMs: input.nowMs,
			selectedOrganizationId: null,
			step: "organization",
		}),
	};
}

export function resolveOnboardingSteps(input: {
	isPersonal: boolean;
}): readonly OpenMeldOnboardingStep[] {
	return input.isPersonal
		? PERSONAL_ONBOARDING_STEPS
		: OPENMELD_ONBOARDING_STEPS;
}

export function resolveOnboardingStep(input: {
	currentStep: OpenMeldOnboardingStep;
	isPersonal: boolean;
}): OpenMeldOnboardingStep {
	return resolveOnboardingSteps(input).includes(input.currentStep)
		? input.currentStep
		: "organization";
}

export function resolveNextOnboardingStep(input: {
	currentStep: OpenMeldOnboardingStep;
	isPersonal: boolean;
}): OpenMeldOnboardingStep {
	const steps = resolveOnboardingSteps(input);
	const currentIndex = steps.indexOf(input.currentStep);
	if (currentIndex < 0) {
		return "organization";
	}
	return steps[Math.min(currentIndex + 1, steps.length - 1)] ?? "complete";
}

export function resolvePreviousOnboardingStep(input: {
	currentStep: OpenMeldOnboardingStep;
	isPersonal: boolean;
}): OpenMeldOnboardingStep {
	const steps = resolveOnboardingSteps(input);
	const currentIndex = steps.indexOf(input.currentStep);
	if (currentIndex < 0) {
		return "organization";
	}
	return steps[Math.max(currentIndex - 1, 0)] ?? "organization";
}

export function completeOnboardingProgress(input: {
	current: OpenMeldOnboardingProgress;
	nowMs?: number;
}): OpenMeldOnboardingProgress {
	const nowMs = input.nowMs ?? Date.now();
	return {
		...input.current,
		completedAtMs: nowMs,
		currentStep: "complete",
		updatedAtMs: nowMs,
	};
}

export function restartOnboardingProgress(input: {
	current: OpenMeldOnboardingProgress;
	nowMs?: number;
	returnTo?: string | null;
}): OpenMeldOnboardingProgress {
	return {
		...input.current,
		completedAtMs: null,
		currentStep: "organization",
		returnTo:
			input.returnTo === undefined
				? input.current.returnTo
				: normalizeReturnPath(input.returnTo),
		updatedAtMs: input.nowMs ?? Date.now(),
	};
}

export function resolveOnboardingReturnPath(input: {
	currentOrganizationSlug: string;
	progress: OpenMeldOnboardingProgress;
}): string {
	const fallback = buildOrganizationDefaultPath(input.currentOrganizationSlug);
	const returnTo = normalizeReturnPath(input.progress.returnTo);
	if (!returnTo || returnTo.includes("/onboarding")) {
		return fallback;
	}
	return returnTo.replace(
		ORGANIZATION_PATH_PREFIX_PATTERN,
		`/o/${encodeURIComponent(input.currentOrganizationSlug)}`
	);
}

function isOnboardingProgress(
	value: unknown
): value is OpenMeldOnboardingProgress {
	if (!isRecord(value)) {
		return false;
	}
	return (
		value.version === OPENMELD_ONBOARDING_VERSION &&
		typeof value.updatedAtMs === "number" &&
		(value.completedAtMs === null || typeof value.completedAtMs === "number") &&
		typeof value.currentStep === "string" &&
		OPENMELD_ONBOARDING_STEPS.includes(
			value.currentStep as OpenMeldOnboardingStep
		) &&
		(value.returnTo === null || typeof value.returnTo === "string") &&
		(value.selectedOrganizationId === null ||
			typeof value.selectedOrganizationId === "string")
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeReturnPath(value: string | null | undefined): string | null {
	if (!value?.startsWith("/") || value.startsWith("//")) {
		return null;
	}
	return value.slice(0, 2000);
}

function reportOnboardingStorageFailure(input: {
	error: unknown;
	operation: "read" | "write";
	storageScope: string;
}): void {
	console.error("[web.onboarding.progress_storage_failed]", {
		error:
			input.error instanceof Error ? input.error.message : String(input.error),
		event: "web.onboarding.progress_storage_failed",
		operation: input.operation,
		storageScope: input.storageScope,
	});
}
