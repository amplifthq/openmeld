import type { createSpaceApi } from "@openmeld/api-client";
import {
	accountSpaceActiveWakeSummaryResponseSchema,
	agentInteractionResolutionSchema,
	postSpaceWakeStopResponseSchema,
	wakeProgressItemSchema,
} from "@openmeld/schemas";
import type {
	AccountSpaceActiveWakeSummaryResponse,
	AgentInteractionRequest,
	GetActiveSpaceWakeProgressResponse,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import { currentFixtureManifest, isLocalFixtureHost } from "./fixture-manifest";

type SpaceApi = ReturnType<typeof createSpaceApi>;
type Scenario = {
	spaceId: string;
	profileId: string;
	profileName: string;
	sourceSignalId: string;
	scenario:
		| "working"
		| "conversation_wait"
		| "plan_review"
		| "permission"
		| "question";
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
		// A running simulation represents continuing progress, not a disconnected
		// runtime. Keep its start time stable while each read supplies fresh evidence.
		return existing.terminal
			? existing
			: { ...existing, updatedAtMs: Date.now() };
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
	if (scenario.scenario === "question") {
		request = {
			...common,
			kind: "question",
			title: "Choose the rollout approach",
			questions: [
				{
					questionId: "audience",
					prompt: "Who should receive the first release?",
					options: [
						{ optionId: "team", label: "Internal team" },
						{ optionId: "pilot", label: "Pilot customers" },
					],
					multiple: false,
					allowOther: true,
				},
				{
					questionId: "checks",
					prompt: "Which checks should we include?",
					options: [
						{ optionId: "keyboard", label: "Keyboard navigation" },
						{ optionId: "billing", label: "Billing regression" },
					],
					multiple: true,
					allowOther: true,
				},
			],
		};
	} else if (
		scenario.scenario !== "working" &&
		scenario.scenario !== "conversation_wait"
	) {
		request =
			scenario.scenario === "plan_review"
				? {
						...common,
						kind: "plan_review",
						title: "Review the release plan",
						allowFeedback: true,
						plan: `## Release plan\n\n${Array.from({ length: 16 }, (_, index) => `### ${index + 1}. Validate the rollout\n\nCheck invoices, refunds, and empty accounts in the sandbox. Compare totals with the previous release and record any differences. Verify keyboard navigation and confirm that error messages describe a useful next step.\n\n`).join("")}## Rollback\n\nRestore the previous deployment if totals differ. No production changes happen until this plan is approved.`,
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
		phase: scenario.scenario === "conversation_wait" ? "connecting" : "running",
		...(scenario.scenario === "conversation_wait"
			? {
					waitReasonCode: "runtime.agent_controller_conversation.occupied",
				}
			: {}),
		terminal: false,
		wakeStopEligibility: {
			status: "eligible",
			controlMode: "cancel",
			reliability: "native_cancel",
			reasonCode: null,
		},
		message: "Checking the implementation and running focused checks.",
		...(scenario.scenario === "conversation_wait"
			? {}
			: { startedAtMs: now - 45_000 }),
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

/** Account discovery and Space detail are projections of the same fixture state. */
export async function withLocalAccountRuntimeFixtures(
	summary: AccountSpaceActiveWakeSummaryResponse,
	viewer: string,
	read: (spaceId: string) => Promise<GetActiveSpaceWakeProgressResponse>
) {
	const progress: {
		spaceId: string;
		data: GetActiveSpaceWakeProgressResponse;
	}[] = [];
	if (!(import.meta.env.DEV && isLocalFixtureHost())) {
		return { summary, progress };
	}
	const manifest = currentFixtureManifest();
	if (manifest.profileId !== viewer) {
		return { summary, progress };
	}
	const snapshots = await Promise.all(
		manifest.spaces.map(async ({ spaceId }) => {
			if (!fixture(spaceId, viewer)) {
				return null;
			}
			return { spaceId, data: await read(spaceId) };
		})
	);
	const items = new Map(summary.items.map((item) => [item.spaceId, item]));
	for (const snapshot of snapshots) {
		if (!snapshot) {
			continue;
		}
		progress.push(snapshot);
		if (items.has(snapshot.spaceId)) {
			continue;
		}
		const targets = new Map<
			string,
			{ profileId: string; profileName: string; activeWakeCount: number }
		>();
		for (const item of snapshot.data.items) {
			if (item.terminal) {
				continue;
			}
			const target = targets.get(item.targetProfileId);
			targets.set(item.targetProfileId, {
				profileId: item.targetProfileId,
				profileName: item.targetLabel,
				activeWakeCount: (target?.activeWakeCount ?? 0) + 1,
			});
		}
		const activeTargets = [...targets.values()];
		if (activeTargets.length) {
			items.set(snapshot.spaceId, {
				spaceId: snapshot.spaceId,
				activeWakeCount: activeTargets.reduce(
					(total, target) => total + target.activeWakeCount,
					0
				),
				activeTargets,
			});
		}
	}
	return {
		summary: accountSpaceActiveWakeSummaryResponseSchema.parse({
			...summary,
			items: [...items.values()],
		}),
		progress,
	};
}

/** Disposable API response simulation. No JSX, runtime writes, or execution authority. */
export function withLocalSpaceRuntimeFixtures(
	api: SpaceApi,
	viewer?: string
): SpaceApi {
	return {
		...api,
		async postWakeStop(input) {
			const item = fixture(input.spaceId, viewer);
			const target = input.body.target;
			const sourceId =
				target.by === "source_signal"
					? target.sourceSignalId
					: target.clientMessageId;
			if (
				!item ||
				target.targetProfileId !== item.targetProfileId ||
				sourceId !== item.sourceSignalId
			) {
				return api.postWakeStop(input);
			}
			// Check real access; synthetic executions never reach runtime controls.
			await api.getActiveWakeProgress({ spaceId: input.spaceId });
			const now = Date.now();
			states.set(`${viewer}:${input.spaceId}`, {
				...item,
				phase: "stopped",
				terminal: true,
				message: "Stopped",
				pendingInteraction: null,
				updatedAtMs: now,
			});
			return postSpaceWakeStopResponseSchema.parse({
				ok: true,
				status: "cancelled",
				targetProfileId: item.targetProfileId,
				runtimeCoordinatorExecutionId: item.runtimeCoordinatorExecutionId,
				cancellationState: {
					status: "cancelled",
					reasonCode: null,
					observedAtMs: now,
				},
			});
		},
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
