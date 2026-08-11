"use client";

const PREPARE_SESSION_POINTER_STORAGE_KEY = "openmeld.prepare.session.pointer";
export const COMPLETED_PREPARE_SESSION_POINTER_STORAGE_KEY =
	"openmeld.prepare.session.completed.pointer";

export type PrepareSessionPointer = {
	connectedComputerId?: string | null;
	deviceId: string | null;
	humanProfileId: string;
	opaqueToken: string | null;
	opaqueTokenExpiresAt: string | null;
	prepareSessionId: string;
	runtimeLane: string | null;
	targetSpaceId: string | null;
};

export type PrepareSessionPointerInput = {
	connectedComputerId?: string | null;
	deviceId: string | null;
	humanProfileId: string | null;
	runtimeLane: string | null;
	targetSpaceId: string | null;
};

export function buildPrepareSessionKey(
	input: PrepareSessionPointerInput
): string | null {
	if (input.humanProfileId === null) {
		return null;
	}

	return [
		input.humanProfileId,
		input.connectedComputerId ?? input.deviceId ?? "no-computer",
		input.runtimeLane ?? "no-runtime-lane",
		input.targetSpaceId ?? "no-target-space",
	].join(":");
}

export function readPrepareSessionPointer(): PrepareSessionPointer | null {
	return readPrepareSessionPointerFromStorage(
		PREPARE_SESSION_POINTER_STORAGE_KEY
	);
}

export function readCompletedPrepareSessionPointer(): PrepareSessionPointer | null {
	return readPrepareSessionPointerFromStorage(
		COMPLETED_PREPARE_SESSION_POINTER_STORAGE_KEY
	);
}

function readPrepareSessionPointerFromStorage(
	storageKey: string
): PrepareSessionPointer | null {
	if (typeof window === "undefined") {
		return null;
	}

	try {
		const raw = window.localStorage.getItem(storageKey);
		if (!raw) {
			return null;
		}
		const parsed = JSON.parse(raw) as Partial<PrepareSessionPointer>;
		if (
			typeof parsed.prepareSessionId !== "string" ||
			!(
				typeof parsed.deviceId === "string" ||
				parsed.deviceId === null ||
				parsed.deviceId === undefined
			) ||
			typeof parsed.humanProfileId !== "string"
		) {
			return null;
		}
		return {
			...(typeof parsed.connectedComputerId === "string"
				? { connectedComputerId: parsed.connectedComputerId }
				: {}),
			deviceId: typeof parsed.deviceId === "string" ? parsed.deviceId : null,
			humanProfileId: parsed.humanProfileId,
			opaqueToken:
				typeof parsed.opaqueToken === "string" ? parsed.opaqueToken : null,
			opaqueTokenExpiresAt:
				typeof parsed.opaqueTokenExpiresAt === "string"
					? parsed.opaqueTokenExpiresAt
					: null,
			prepareSessionId: parsed.prepareSessionId,
			runtimeLane:
				typeof parsed.runtimeLane === "string" ? parsed.runtimeLane : null,
			targetSpaceId:
				typeof parsed.targetSpaceId === "string" ? parsed.targetSpaceId : null,
		};
	} catch {
		return null;
	}
}

export function writePrepareSessionPointer(
	pointer: PrepareSessionPointer
): void {
	writePrepareSessionPointerToStorage(
		PREPARE_SESSION_POINTER_STORAGE_KEY,
		pointer
	);
}

export function writeCompletedPrepareSessionPointer(
	pointer: PrepareSessionPointer
): void {
	writePrepareSessionPointerToStorage(
		COMPLETED_PREPARE_SESSION_POINTER_STORAGE_KEY,
		pointer
	);
}

function writePrepareSessionPointerToStorage(
	storageKey: string,
	pointer: PrepareSessionPointer
): void {
	if (typeof window === "undefined") {
		return;
	}
	window.localStorage.setItem(storageKey, JSON.stringify(pointer));
}

export function clearPrepareSessionPointer(): void {
	if (typeof window === "undefined") {
		return;
	}
	window.localStorage.removeItem(PREPARE_SESSION_POINTER_STORAGE_KEY);
}

export function clearCompletedPrepareSessionPointer(): void {
	if (typeof window === "undefined") {
		return;
	}
	window.localStorage.removeItem(COMPLETED_PREPARE_SESSION_POINTER_STORAGE_KEY);
}

export function pointerMatchesPrepareSessionInput(
	pointer: PrepareSessionPointer | null,
	input: PrepareSessionPointerInput
): pointer is PrepareSessionPointer {
	if (
		pointer === null ||
		pointer.humanProfileId !== input.humanProfileId ||
		pointer.targetSpaceId !== input.targetSpaceId
	) {
		return false;
	}
	if (input.connectedComputerId) {
		return pointer.connectedComputerId === input.connectedComputerId;
	}
	return (
		prepareContextValueIsCompatible(pointer.deviceId, input.deviceId) &&
		prepareContextValueIsCompatible(pointer.runtimeLane, input.runtimeLane)
	);
}

export function pointerMatchesCurrentComputerPrepareContext(
	pointer: PrepareSessionPointer | null,
	input: Omit<PrepareSessionPointerInput, "targetSpaceId">
): pointer is PrepareSessionPointer {
	return (
		pointer !== null &&
		pointer.humanProfileId === input.humanProfileId &&
		prepareContextValueIsCompatible(pointer.deviceId, input.deviceId) &&
		prepareContextValueIsCompatible(pointer.runtimeLane, input.runtimeLane)
	);
}

export function completedPointerMatchesCurrentComputerPrepareContext(
	pointer: PrepareSessionPointer | null,
	input: Omit<PrepareSessionPointerInput, "targetSpaceId">
): pointer is PrepareSessionPointer {
	return (
		pointer !== null &&
		input.humanProfileId !== null &&
		input.deviceId !== null &&
		input.runtimeLane !== null &&
		pointer.humanProfileId === input.humanProfileId &&
		pointer.deviceId === input.deviceId &&
		pointer.runtimeLane === input.runtimeLane
	);
}

function prepareContextValueIsCompatible(
	pointerValue: string | null,
	inputValue: string | null
): boolean {
	return (
		pointerValue === null || inputValue === null || pointerValue === inputValue
	);
}
