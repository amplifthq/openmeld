import type { createSpaceApi } from "@openmeld/api-client";
import {
	agentInteractionResolutionSchema,
	wakeProgressItemSchema,
} from "@openmeld/schemas";
import type {
	AgentInteractionRequest,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import { currentFixtureManifest, isLocalFixtureHost } from "./fixture-manifest";

type SpaceApi = ReturnType<typeof createSpaceApi>;
type Scenario = {
	spaceId: string;
	profileId: string;
	profileName: string;
	sourceSignalId: string;
	scenario: "working" | "plan_review" | "permission";
};
const states = new Map<string, WakeProgressItem>();

function fixture(spaceId: string, viewer?: string): WakeProgressItem | null {
	if (!(import.meta.env.DEV && isLocalFixtureHost())) {
		return null;
	}
	const manifest = currentFixtureManifest();
	if (manifest.profileId !== viewer) {
		return null;
	}
	const scenario = (manifest.spaces as unknown as Scenario[]).find(
		(item) => item.spaceId === spaceId && item.sourceSignalId && item.scenario
	);
	if (!scenario) {
		return null;
	}
	const key = `${viewer}:${spaceId}`;
	const existing = states.get(key);
	if (existing) {
		return existing;
	}
	const now = Date.now();
	const interactionId = `seed:${scenario.sourceSignalId}`;
	const common = {
		v: 1 as const,
		interactionId,
		requestedAtMs: now,
		expiresAtMs: now + 86_400_000,
	};
	let request: AgentInteractionRequest | null = null;
	if (scenario.scenario !== "working") {
		request =
			scenario.scenario === "plan_review"
				? {
						...common,
						kind: "plan_review",
						title: "Review the release plan",
						allowFeedback: true,
						plan: "## Release plan\n1. Validate the billing migration in the sandbox.\n2. Check invoices, refunds, and empty accounts.\n3. Review the results before publishing.\n\n## Rollback\nRestore the previous deployment if totals differ.",
					}
				: {
						...common,
						kind: "permission",
						title: "Run the sandbox regression checks?",
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
	}
	const item = wakeProgressItemSchema.parse({
		clientMessageId: scenario.sourceSignalId,
		sourceSignalId: scenario.sourceSignalId,
		dispatchId: interactionId,
		runtimeCoordinatorExecutionId: interactionId,
		targetProfileId: scenario.profileId,
		targetLabel: scenario.profileName,
		phase: "running",
		terminal: false,
		wakeStopEligibility: {
			status: "not_eligible",
			controlMode: null,
			reliability: "unsupported",
			reasonCode: "agent_controller_interface.stop_unsupported",
		},
		message: "Checking the implementation and running focused checks.",
		startedAtMs: now - 45_000,
		updatedAtMs: now,
		...(request
			? {
					pendingInteraction: {
						interactionId,
						kind: request.kind,
						requestedAtMs: now,
						expiresAtMs: request.expiresAtMs,
						canRespond: true,
						request,
					},
				}
			: {}),
	});
	states.set(key, item);
	return item;
}

/** Disposable API response simulation. No JSX, runtime writes, or execution authority. */
export function withLocalSpaceRuntimeFixtures(
	api: SpaceApi,
	viewer?: string
): SpaceApi {
	return {
		...api,
		async getActiveWakeProgress(input) {
			// The real read still owns authentication, membership, and failures.
			const result = await api.getActiveWakeProgress(input);
			const item = fixture(input.spaceId, viewer);
			if (
				!item ||
				(input.sourceProfileId && input.sourceProfileId !== viewer) ||
				(input.targetProfileId &&
					input.targetProfileId !== item.targetProfileId) ||
				result.items.length
			) {
				return result;
			}
			return { ...result, items: [item] };
		},
		async getWakeProgress(input) {
			const result = await api.getWakeProgress(input);
			const item = fixture(input.spaceId, viewer);
			if (
				!item ||
				input.clientMessageId !== item.clientMessageId ||
				(input.targetProfileId &&
					input.targetProfileId !== item.targetProfileId) ||
				result.items.length
			) {
				return result;
			}
			return { ...result, items: [item] };
		},
		async respondToAgentInteraction(input) {
			const item = fixture(input.spaceId, viewer);
			if (
				!item ||
				input.body.runtimeCoordinatorExecutionId !==
					item.runtimeCoordinatorExecutionId
			) {
				return api.respondToAgentInteraction(input);
			}
			await api.getActiveWakeProgress({ spaceId: input.spaceId });
			if (input.body.interactionId !== item.runtimeCoordinatorExecutionId) {
				return {
					ok: false,
					status: "interaction_mismatch",
					message: "The request does not match this interaction.",
				};
			}
			if (!item.pendingInteraction?.request) {
				return {
					ok: true,
					status: "already_resolved",
					respondedAtMs: item.updatedAtMs,
				};
			}
			const parsed = agentInteractionResolutionSchema.safeParse({
				request: item.pendingInteraction.request,
				response: input.body.response,
			});
			if (!parsed.success) {
				return {
					ok: false,
					status: "response_invalid",
					message: "Choose a valid response for this request.",
				};
			}
			const updatedAtMs = Date.now();
			const response = parsed.data.response;
			const stopped =
				response.kind === "cancel" ||
				(response.kind === "permission" && response.optionId === "deny");
			states.set(`${viewer}:${input.spaceId}`, {
				...item,
				pendingInteraction: undefined,
				updatedAtMs,
				phase: stopped ? "stopped" : "running",
				terminal: stopped,
				message: stopped
					? "Permission declined. No command was run."
					: "Review received. Checking the next steps.",
			});
			return { ok: true, status: "accepted", respondedAtMs: updatedAtMs };
		},
	};
}
