"use client";

import type { ReactNode } from "react";
import { ApplicationErrorState } from "#/components/app/application-error-state";
import { SessionExpiredCard } from "#/components/auth/session-expired-card";
import { StartChoicePage } from "#/components/connect/start-choice-page";
import { formatUserFacingLoadError } from "#/lib/connect/user-facing-errors";
import {
	type SessionExpiredState,
	toSessionExpiredState,
} from "#/lib/session-expired";

export function StartBringAgentsErrorState(input: {
	backTo?: string;
	message: string;
	onRetry: () => Promise<void> | void;
	headerAside?: ReactNode;
	sessionExpiredState?: SessionExpiredState | null;
	title?: string;
}) {
	const sessionExpiredState =
		input.sessionExpiredState ?? toSessionExpiredState(input.message);
	return (
		<StartChoicePage
			backTo={input.backTo}
			description={
				sessionExpiredState
					? "Sign in again, then OpenMeld will return you to this step."
					: "OpenMeld needs the latest computer setup state before this step can continue."
			}
			headerAside={input.headerAside}
			title={
				sessionExpiredState
					? "Sign in again"
					: (input.title ?? "Set up local agents")
			}
		>
			<div className="md:col-span-2">
				<BringAgentsSetupErrorContent
					message={input.message}
					onRetry={input.onRetry}
					sessionExpiredState={sessionExpiredState}
				/>
			</div>
		</StartChoicePage>
	);
}

export function BringAgentsSetupErrorContent(input: {
	message: string;
	onRetry: () => Promise<void> | void;
	sessionExpiredState?: SessionExpiredState | null;
}) {
	const visibleMessage = formatUserFacingLoadError(
		input.message,
		"OpenMeld could not load the computers for this setup. Try again. If this keeps happening, restart OpenMeld and try again."
	);

	return input.sessionExpiredState ? (
		<SessionExpiredCard
			className="mx-auto max-w-2xl p-6"
			state={input.sessionExpiredState}
		/>
	) : (
		<ApplicationErrorState
			actionLabel="Retry"
			className="mx-auto"
			description="OpenMeld could not continue this setup step."
			message={visibleMessage}
			onAction={input.onRetry}
		/>
	);
}
