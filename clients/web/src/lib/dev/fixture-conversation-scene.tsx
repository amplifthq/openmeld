import type {
	AgentInteractionRequest,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogTitle,
	DialogTrigger,
} from "@openmeld/ui/components/dialog";
import { useState } from "react";
import { SpaceAgentInteractionCard } from "#/components/spaces/space-agent-interaction-card";
import { SpaceAgentOrb } from "#/components/spaces/space-agent-orb";
import { currentFixtureManifest, isLocalFixtureHost } from "./fixture-manifest";

/** Local presentation only. Responses never reach a Service or execute a command. */
export function FixtureConversationScene(input: {
	spaceId?: string;
	profileId: string;
}) {
	const [completed, setCompleted] = useState(false);
	const manifest = currentFixtureManifest();
	if (
		!(import.meta.env.DEV && isLocalFixtureHost()) ||
		manifest.profileId !== input.profileId
	) {
		return null;
	}
	const scenario = manifest.spaces.find(
		(item) => item.spaceId === input.spaceId
	);
	if (!scenario) {
		return null;
	}
	const now = Date.now();
	const isPlan =
		manifest.spaces.filter((item) => item.needsInput)[0]?.spaceId ===
		input.spaceId;
	const request: AgentInteractionRequest = isPlan
		? {
				v: 1,
				kind: "plan_review",
				interactionId: "fixture-plan",
				requestedAtMs: now,
				expiresAtMs: now + 28_800_000,
				title: "Review the release plan",
				allowFeedback: true,
				plan: "## Release plan\n1. Run the migration against the billing sandbox.\n2. Verify invoices, refunds, and the empty-account case.\n3. Publish only after a human approves the smoke results.\n\n## Rollback\nRestore the previous deployment if invoice totals differ.",
			}
		: {
				v: 1,
				kind: "permission",
				interactionId: "fixture-permission",
				requestedAtMs: now,
				expiresAtMs: now + 28_800_000,
				title: "Run the sandbox regression checks?",
				description:
					"The command writes a local test report and uses the billing sandbox.",
				subject: {
					type: "command",
					command: "pnpm test:billing --environment sandbox",
					cwd: "/workspace/northstar",
				},
				options: [
					{ optionId: "allow", intent: "allow_once", label: "Allow once" },
					{ optionId: "deny", intent: "deny", label: "Deny" },
				],
			};
	const item: WakeProgressItem = {
		clientMessageId: "fixture-message",
		dispatchId: "fixture-dispatch",
		failureReasonCode: null,
		message: "Waiting for your review",
		phase: "running",
		terminal: false,
		runtimeCoordinatorExecutionId: "fixture-execution",
		sourceSignalId: "fixture-signal",
		targetLabel: scenario.profileName,
		targetProfileId: scenario.profileId,
		updatedAtMs: now,
		pendingInteraction: {
			canRespond: true,
			interactionId: request.interactionId,
			kind: request.kind,
			request,
			requestedAtMs: now,
			expiresAtMs: request.expiresAtMs,
		},
	};
	let status = scenario.needsInput
		? "Waiting for your review"
		: "Comparing results and checking edge cases…";
	if (completed) {
		status = "Review recorded";
	}
	return (
		<div className="mx-auto my-4 flex w-full max-w-2xl items-center gap-3 px-4 text-sm">
			<SpaceAgentOrb state={scenario.needsInput ? "listening" : "solving"} />
			<div className="min-w-0 flex-1">
				<p>
					{scenario.profileName}: {status}
				</p>
				<p className="text-muted-foreground text-xs">
					Local simulation · no commands will run
				</p>
			</div>
			{scenario.needsInput && !completed && (
				<Dialog>
					<DialogTrigger render={<Button size="sm" variant="outline" />}>
						Review
					</DialogTrigger>
					<DialogContent>
						<DialogTitle>{request.title}</DialogTitle>
						<SpaceAgentInteractionCard
							item={item}
							onRespond={() => {
								setCompleted(true);
								return Promise.resolve();
							}}
						/>
					</DialogContent>
				</Dialog>
			)}
		</div>
	);
}
