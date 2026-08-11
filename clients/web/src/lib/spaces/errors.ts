import type { StructuredApiClientFailure } from "@openmeld/api-client";

export type SpaceImageUploadFailure = {
	message: string;
	requestId: string | null;
};

export function isProtectedSpaceFailure(
	error: StructuredApiClientFailure | null | undefined
): boolean {
	return (
		error?.code === "space.password_required" ||
		error?.code === "space.password_invalid" ||
		error?.code === "space.password_rate_limited"
	);
}

export function isCurrentSpaceAccessRejection(
	error: StructuredApiClientFailure | null | undefined
): boolean {
	return (
		isProtectedSpaceFailure(error) ||
		error?.code === "space.forbidden" ||
		error?.code === "space.not_found"
	);
}

export function resolveSpaceOpenErrorMessage(
	error: StructuredApiClientFailure
): string {
	if (
		error.code === "network.timeout" ||
		error.code === "network.request_failed"
	) {
		return "OpenMeld couldn't reach this space right now. Try again.";
	}

	if (error.status === 404) {
		return "This Space ID could not be found. Check it and try again.";
	}

	return error.message;
}

export function resolveSpaceComposerSendErrorMessage(
	error: StructuredApiClientFailure
): string {
	if (isSpaceComposerSendOutcomeUnknown(error)) {
		return "OpenMeld couldn't confirm this message yet. It may still appear in the Space, so wait a moment before sending it again.";
	}

	return error.message;
}

export function isSpaceComposerSendOutcomeUnknown(
	error: StructuredApiClientFailure
): boolean {
	return (
		error.code === "network.timeout" || error.code === "network.request_failed"
	);
}

export function resolveSpaceImageUploadFailure(
	error: StructuredApiClientFailure
): SpaceImageUploadFailure {
	if (
		error.code === "space.organization_mismatch" ||
		error.upstreamCode === "space.organization_mismatch"
	) {
		return {
			message:
				"This image couldn't be uploaded because this Space belongs to a different Organization. Refresh the page, then try again.",
			requestId: error.requestId,
		};
	}

	if (
		error.code === "network.timeout" ||
		error.code === "network.request_failed"
	) {
		return {
			message:
				"OpenMeld couldn't upload this image. Check your connection and try again.",
			requestId: error.requestId,
		};
	}

	if (error.status === 401) {
		return {
			message:
				"Your session expired. Refresh the page, then try uploading the image again.",
			requestId: error.requestId,
		};
	}

	if (error.status === 403) {
		return {
			message:
				"You don't have permission to upload images to this Space. Refresh the page, or ask an Organization admin for access.",
			requestId: error.requestId,
		};
	}

	return {
		message:
			"OpenMeld couldn't upload this image right now. Try again in a moment.",
		requestId: error.requestId,
	};
}
