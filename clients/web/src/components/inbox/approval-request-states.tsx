import { Button } from "@openmeld/ui/components/button";
import type { ReactNode } from "react";

/**
 * Shared states of an ApprovalCard request (Plugin actions, Agent access,
 * sensitive CLI confirmations): unavailable, the settled outcome, and the
 * answer / refresh errors. Keeps every request card's wording and recovery
 * the same.
 */
export function ApprovalRequestUnavailable(input: {
	message: string;
	onRefresh: () => void;
	/** Defaults to "Refresh request". */
	refreshLabel?: string;
	/** Another way forward beside Refresh, e.g. Open conversation. */
	children?: ReactNode;
}) {
	return (
		<div className="mt-3 space-y-2 rounded-md border border-border/70 p-4">
			<p className="text-destructive text-sm" role="alert">
				{input.message}
			</p>
			<div className="flex items-center gap-3">
				<Button onClick={input.onRefresh} size="sm" variant="outline">
					{input.refreshLabel ?? "Refresh request"}
				</Button>
				{input.children}
			</div>
		</div>
	);
}

/** What happened to a settled request, in place of its answer buttons. */
export function ApprovalRequestOutcome({ children }: { children: ReactNode }) {
	return (
		<output className="block border-border/70 border-t pt-3 text-sm">
			{children}
		</output>
	);
}

/** The answer's error and a failed refresh, which also disables answering. */
export function ApprovalRequestErrors(input: {
	error: string | null;
	refetchFailed: boolean;
	onRefresh: () => void;
}) {
	return (
		<>
			{input.error ? (
				<p className="text-destructive text-sm" role="alert">
					{input.error}
				</p>
			) : null}
			{input.refetchFailed ? (
				<div className="space-y-2">
					<p className="text-destructive text-sm" role="alert">
						Couldn’t refresh this request. Confirm its current status before
						responding.
					</p>
					<Button onClick={input.onRefresh} size="sm" variant="outline">
						Refresh request
					</Button>
				</div>
			) : null}
		</>
	);
}
