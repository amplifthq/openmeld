"use client";

import { Button } from "@openmeld/ui/components/button";
import {
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import {
	TabsSubtle,
	TabsSubtleItem,
	TabsSubtlePanel,
} from "@openmeld/ui/fluid/tabs-subtle";
import { springs } from "@openmeld/ui/lib/springs";
import { resolveStatusToneIconClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
	BookOpenIcon,
	BotIcon,
	CheckIcon,
	CopyIcon,
	KeyRoundIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CrossPageHeader } from "#/components/app/cross-page-header";
import {
	APP_PAGE_FRAME_CLASS_NAME,
	APP_PAGE_FRAME_PADDING_CLASS_NAME,
} from "#/components/app/shell-layout";
import { buildAgentInterfacePrompt } from "#/lib/agent-interface-guide";
import {
	buildWebSetupCommand,
	resolveBrowserSetupCommandPlatform,
	resolveWebSetupFollowUpCliCommandPrefix,
} from "#/lib/cli-entry-command";
import { copyTextToClipboard } from "#/lib/clipboard";
import { resolveComputerAuthorizationHandoffExpiresAt } from "#/lib/computer-authorization-expiry";
import { Elevated } from "#/lib/elevated";
import { listStartProfiles } from "#/lib/profiles/existing-profiles";
import { listActiveProfilesByKind } from "#/lib/profiles/human-profiles";
import { createComputerAuthorizationGrant } from "#/query/auth-query";
import { createPrepareSession } from "#/query/connect/prepare-session";
import { baseQueryOptions } from "#/query/query-config";

const OPENMELD_SKILL_PATH = "/SKILL.md";
const SIGN_IN_HREF = "/login?redirect=%2Fagent-interface";
const HANDOFF_CONTENT_TRANSITION = {
	duration: 0.18,
	ease: [0.22, 1, 0.36, 1],
} as const;

type AgentInterfacePageProps = {
	isAuthenticated: boolean;
};

type GeneratedAgentInterfaceState = {
	command: string;
	expiresAt: string;
	prompt: string;
	skillUrl: string;
	profileName: string | null;
};

type PromptActionKind = "copy" | "generate";

type InFlightPromptAction = {
	id: number;
	promise: Promise<void>;
};

type PendingPromptAction = {
	id: number;
	kind: PromptActionKind;
};

type PromptForAction = {
	didGenerateFreshPrompt: boolean;
	prompt: GeneratedAgentInterfaceState;
};

export function AgentInterfacePage({
	isAuthenticated,
}: AgentInterfacePageProps) {
	const [generated, setGenerated] =
		useState<GeneratedAgentInterfaceState | null>(null);
	const [pendingPromptActionState, setPendingPromptActionState] =
		useState<PendingPromptAction | null>(null);
	const [actionPreviewIndex, setActionPreviewIndex] = useState(0);
	const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
	const [now, setNow] = useState(() => Date.now());
	const isMountedRef = useRef(false);
	const promptActionIdRef = useRef(0);
	const inFlightPromptActionRef = useRef<InFlightPromptAction | null>(null);
	const profilesQuery = useQuery({
		queryKey: ["agent-interface", "profiles"],
		queryFn: async () => await listStartProfiles(),
		enabled: isAuthenticated,
		retry: baseQueryOptions.retry,
		staleTime: baseQueryOptions.staleTime,
		refetchOnWindowFocus: false,
	});
	const defaultHumanProfile = useMemo(
		() =>
			listActiveProfilesByKind(profilesQuery.data ?? [], "human")[0] ?? null,
		[profilesQuery.data]
	);
	const skillUrl = resolveSkillUrl();
	const pendingPromptAction =
		isAuthenticated &&
		pendingPromptActionState?.id === promptActionIdRef.current
			? pendingPromptActionState.kind
			: null;
	const isPromptActionPending = pendingPromptAction !== null;
	const canGenerate = isAuthenticated && !isPromptActionPending;
	const generatedRemainingSeconds = useMemo(
		() => resolveRemainingSeconds(generated?.expiresAt ?? null, now),
		[generated?.expiresAt, now]
	);
	const isGeneratedExpired = generated
		? isPromptExpired(generated.expiresAt, now)
		: false;
	const generateActionLabel = resolveGenerateActionLabel({
		hasGeneratedPrompt: Boolean(generated),
		isExpired: isGeneratedExpired,
	});

	useEffect(() => {
		isMountedRef.current = true;

		return () => {
			isMountedRef.current = false;
			promptActionIdRef.current += 1;
			inFlightPromptActionRef.current = null;
		};
	}, []);

	useEffect(() => {
		if (isAuthenticated) {
			return;
		}

		promptActionIdRef.current += 1;
		inFlightPromptActionRef.current = null;
	}, [isAuthenticated]);

	useEffect(() => {
		if (!generated) {
			return;
		}

		setNow(Date.now());
		const timer = window.setInterval(() => {
			setNow(Date.now());
		}, 1000);

		return () => {
			window.clearInterval(timer);
		};
	}, [generated]);

	async function createFreshAgentPrompt(): Promise<GeneratedAgentInterfaceState> {
		const humanProfile = await resolveBestHumanProfile(defaultHumanProfile);
		const [prepareSession, computerAuthorization] = await Promise.all([
			createPrepareSession({
				deviceId: null,
				humanProfileId: humanProfile?.openMeldProfileId ?? null,
				runtimeLane: null,
				targetSpaceId: null,
				selectedLocalAgentIds: [],
			}),
			createComputerAuthorizationGrant(),
		]);
		const command = buildWebSetupCommand({
			startSession: prepareSession.opaqueToken,
			deviceCode: computerAuthorization.deviceCode,
			localAgents: "all",
			setupPlatform: resolveBrowserSetupCommandPlatform(),
			view: "agent",
		});
		const prompt = buildAgentInterfacePrompt({
			cliCommandPrefix: resolveWebSetupFollowUpCliCommandPrefix(),
			command,
			skillUrl,
		});

		return {
			command,
			expiresAt: resolveComputerAuthorizationHandoffExpiresAt({
				authorizationExpiresInSeconds: computerAuthorization.expiresIn,
				prepareSessionExpiresAt: prepareSession.opaqueTokenExpiresAt,
			}),
			profileName: humanProfile?.profileName ?? null,
			prompt,
			skillUrl,
		};
	}

	function isCurrentPromptAction(actionId: number): boolean {
		return isMountedRef.current && promptActionIdRef.current === actionId;
	}

	async function resolvePromptForAction(
		kind: PromptActionKind
	): Promise<PromptForAction> {
		if (
			kind === "copy" &&
			generated &&
			!isPromptExpired(generated.expiresAt, Date.now())
		) {
			return { didGenerateFreshPrompt: false, prompt: generated };
		}

		return {
			didGenerateFreshPrompt: true,
			prompt: await createFreshAgentPrompt(),
		};
	}

	function presentPromptCopyResult(input: {
		didCopy: boolean;
		didGenerateFreshPrompt: boolean;
		kind: PromptActionKind;
	}) {
		if (input.didCopy) {
			setCopyState("copied");
			toast.success(resolvePromptCopiedMessage(input));
			return;
		}

		if (input.kind === "generate") {
			toast.success("OpenMeld Agent Interface prompt generated.");
			toast.error(
				"OpenMeld could not copy automatically. Use Copy agent prompt to copy it manually."
			);
			return;
		}
		toast.error(
			input.didGenerateFreshPrompt
				? "OpenMeld refreshed the prompt but could not copy it. Try again, or select the prompt text and copy it manually."
				: "OpenMeld could not copy the prompt. Try again, or select the prompt text and copy it manually."
		);
	}

	async function performPromptAction(
		actionId: number,
		kind: PromptActionKind
	): Promise<void> {
		try {
			const { didGenerateFreshPrompt, prompt } =
				await resolvePromptForAction(kind);
			if (!isCurrentPromptAction(actionId)) {
				return;
			}
			if (isPromptExpired(prompt.expiresAt, Date.now())) {
				throw new Error(
					"OpenMeld created a prompt that expired before it could be copied. Try again."
				);
			}
			if (didGenerateFreshPrompt) {
				setGenerated(prompt);
			}

			const didCopy = await copyTextToClipboard(prompt.prompt).catch(
				() => false
			);
			if (!isCurrentPromptAction(actionId)) {
				return;
			}
			presentPromptCopyResult({ didCopy, didGenerateFreshPrompt, kind });
		} catch (error) {
			if (isCurrentPromptAction(actionId)) {
				toast.error(resolveErrorMessage(error));
			}
		} finally {
			if (inFlightPromptActionRef.current?.id === actionId) {
				inFlightPromptActionRef.current = null;
			}
			if (isCurrentPromptAction(actionId)) {
				setPendingPromptActionState(null);
			}
		}
	}

	function startPromptAction(
		kind: PromptActionKind
	): Promise<void> | undefined {
		if (!isAuthenticated) {
			return;
		}
		const currentAction = inFlightPromptActionRef.current;
		if (currentAction) {
			return currentAction.promise;
		}

		const actionId = promptActionIdRef.current + 1;
		promptActionIdRef.current = actionId;
		setPendingPromptActionState({ id: actionId, kind });
		setCopyState("idle");

		const promise = performPromptAction(actionId, kind);

		inFlightPromptActionRef.current = { id: actionId, promise };
		return promise;
	}

	function handleActionTabSelect(nextIndex: number) {
		setActionPreviewIndex(nextIndex);
		if (nextIndex === 0) {
			if (!isAuthenticated) {
				window.location.assign(SIGN_IN_HREF);
				return;
			}
			if (!canGenerate) {
				return;
			}
			startPromptAction("generate");
			return;
		}
		window.location.assign(OPENMELD_SKILL_PATH);
	}

	function handleGeneratePromptTextClick() {
		handleActionTabSelect(0);
	}

	const generatePromptDescription = resolveGeneratePromptDescription({
		hasGeneratedPrompt: Boolean(generated),
		isAuthenticated,
		isExpired: isGeneratedExpired,
		isGenerating: isPromptActionPending,
	});
	const handoffTitle = generated
		? "Copy this prompt into your AI agent"
		: "Agent handoff";
	const skillPromptDescription =
		"Use the public Skill when your agent only needs to learn OpenMeld concepts and CLI usage. It does not include private setup access or sign the agent into OpenMeld.";
	const copyActionLabel = resolveCopyActionLabel({
		copyState,
		isExpired: isGeneratedExpired,
		pendingPromptAction,
	});
	const showCopiedIcon =
		copyState === "copied" &&
		!isGeneratedExpired &&
		pendingPromptAction !== "copy";

	return (
		<main className="min-h-svh bg-background">
			<CrossPageHeader />
			<section
				className={`mx-auto w-full ${APP_PAGE_FRAME_PADDING_CLASS_NAME} ${APP_PAGE_FRAME_CLASS_NAME}`}
			>
				<div className="grid min-h-[calc(100svh-3.5rem)] gap-8 px-6 py-12 sm:px-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(360px,0.6fr)] lg:px-14 lg:py-16">
					<div className="min-w-0 max-w-3xl self-center">
						<div className="mb-5 inline-flex items-center gap-2 font-mono text-muted-foreground text-xs uppercase tracking-normal">
							<BotIcon className="size-4" />
							OpenMeld Agent Interface
						</div>
						<h1 className="text-balance font-semibold text-4xl tracking-normal sm:text-5xl">
							Set up OpenMeld with your AI agent
						</h1>
						<p className="mt-5 max-w-2xl text-base text-muted-foreground leading-7">
							We believe the best app interface is the agent you already use:{" "}
							<InlineAgentName agentId="builtin:codex" label="Codex" /> or{" "}
							<InlineAgentName
								agentId="builtin:claude-code"
								label="Claude Code"
							/>
							. Sign in once, copy one prompt, and let it learn OpenMeld, set it
							up, and run Spaces from your chat.
						</p>
						<div className="mt-7 max-w-xl">
							<TabsSubtle
								aria-label="Agent Interface actions"
								className="inline-flex flex-wrap gap-1 overflow-visible bg-transparent p-0.5 sm:flex-nowrap"
								idPrefix="agent-interface-actions"
								onSelect={handleActionTabSelect}
								selectedIndex={actionPreviewIndex}
								variant="solid"
							>
								<TabsSubtleItem
									className="h-9 min-w-48 justify-start gap-1.5 px-2.5 sm:gap-2 sm:px-3"
									disabled={isAuthenticated && !canGenerate}
									icon={KeyRoundIcon}
									index={0}
									label={generateActionLabel}
									onFocus={() => setActionPreviewIndex(0)}
									onMouseEnter={() => setActionPreviewIndex(0)}
								/>
								<TabsSubtleItem
									className="h-9 gap-1.5 px-2.5 sm:gap-2 sm:px-3"
									icon={BookOpenIcon}
									index={1}
									label="Open OpenMeld Skill"
									onFocus={() => setActionPreviewIndex(1)}
									onMouseEnter={() => setActionPreviewIndex(1)}
								/>
							</TabsSubtle>
						</div>
						<TabsSubtlePanel
							aria-live="polite"
							className="mt-4 min-h-20 max-w-xl text-muted-foreground text-xs leading-5 sm:min-h-10"
							idPrefix="agent-interface-actions"
							index={0}
							selectedIndex={actionPreviewIndex}
						>
							{generatePromptDescription}
						</TabsSubtlePanel>
						<TabsSubtlePanel
							aria-live="polite"
							className="mt-4 min-h-20 max-w-xl text-muted-foreground text-xs leading-5 sm:min-h-10"
							idPrefix="agent-interface-actions"
							index={1}
							selectedIndex={actionPreviewIndex}
						>
							{skillPromptDescription}
						</TabsSubtlePanel>
					</div>

					<motion.div
						className="w-full min-w-0 self-center"
						layout
						transition={springs.slow}
					>
						<Elevated
							className="relative flex w-full flex-col gap-4 overflow-visible rounded-md py-4 text-card-foreground text-xs/relaxed"
							offset={2}
							shadowLevel={5}
						>
							<CardHeader>
								<CardTitle>{handoffTitle}</CardTitle>
								{generated ? null : (
									<CardDescription className="min-h-5 overflow-hidden">
										<AnimatePresence initial={false} mode="wait">
											<motion.span
												animate={{ filter: "blur(0px)", opacity: 1, y: 0 }}
												className="block"
												exit={{ filter: "blur(4px)", opacity: 0, y: -3 }}
												initial={{ filter: "blur(4px)", opacity: 0, y: 3 }}
												key="empty-description"
												transition={HANDOFF_CONTENT_TRANSITION}
											>
												The private prompt will appear here after{" "}
												<button
													className="inline cursor-pointer border-0 bg-transparent p-0 text-inherit transition-[filter,opacity] duration-150 hover:opacity-95 hover:brightness-125 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
													disabled={isAuthenticated && !canGenerate}
													onClick={handleGeneratePromptTextClick}
													type="button"
												>
													generation
												</button>
												.
											</motion.span>
										</AnimatePresence>
									</CardDescription>
								)}
							</CardHeader>
							<CardContent className="overflow-visible">
								<AnimatePresence initial={false} mode="wait">
									{generated ? (
										<motion.div
											animate={{ filter: "blur(0px)", opacity: 1, y: 0 }}
											className="space-y-4"
											exit={{ filter: "blur(6px)", opacity: 0, y: -6 }}
											initial={{ filter: "blur(6px)", opacity: 0, y: 8 }}
											key="generated-handoff-content"
											layout
											transition={HANDOFF_CONTENT_TRANSITION}
										>
											<div className="grid gap-2 text-muted-foreground text-xs">
												<div className="flex items-center gap-2">
													<CheckIcon
														className={cn(
															"size-3.5",
															resolveStatusToneIconClassName("ready")
														)}
													/>
													<span>
														Setup will connect all detected local agents
														{generated.profileName
															? ` for ${generated.profileName}`
															: ""}
														.
													</span>
												</div>
												<div className="flex items-center gap-2">
													<CheckIcon
														className={cn(
															"size-3.5",
															resolveStatusToneIconClassName("ready")
														)}
													/>
													<span>OpenMeld Skill URL: {generated.skillUrl}</span>
												</div>
											</div>
											<Elevated
												aria-label="Generated agent prompt"
												className="max-h-80 overflow-auto rounded-md p-4 font-mono text-foreground text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
												offset={3}
												role="region"
												shadowLevel={6}
												tabIndex={0}
											>
												<pre className="m-0 whitespace-pre-wrap break-words">
													{generated.prompt}
												</pre>
											</Elevated>
											<div className="flex flex-wrap items-end justify-between gap-3">
												<Button
													aria-busy={pendingPromptAction === "copy"}
													disabled={isPromptActionPending}
													onClick={() => startPromptAction("copy")}
													type="button"
													variant="secondary"
												>
													{showCopiedIcon ? (
														<CheckIcon className="size-4" />
													) : (
														<CopyIcon className="size-4" />
													)}
													{copyActionLabel}
												</Button>
												<PromptExpiryStatus
													remainingSeconds={generatedRemainingSeconds}
												/>
											</div>
										</motion.div>
									) : (
										<motion.div
											animate={{ filter: "blur(0px)", opacity: 1, y: 0 }}
											exit={{ filter: "blur(6px)", opacity: 0, y: -6 }}
											initial={{ filter: "blur(6px)", opacity: 0, y: 8 }}
											key="empty-handoff-content"
											layout
											transition={HANDOFF_CONTENT_TRANSITION}
										>
											<EmptyAgentHandoffState />
										</motion.div>
									)}
								</AnimatePresence>
							</CardContent>
						</Elevated>
					</motion.div>
				</div>
			</section>
		</main>
	);
}

function InlineAgentName({
	agentId,
	label,
}: {
	agentId: string;
	label: string;
}) {
	return (
		<span className="inline-flex items-center gap-1 whitespace-nowrap align-baseline">
			<LocalAgentLogo agentId={agentId} className="relative top-px" size="xs" />
			<span>{label}</span>
		</span>
	);
}

function EmptyAgentHandoffState() {
	return (
		<section>
			<p className="m-0 font-medium text-sm">What your agent will do</p>
			<ul className="mt-3 space-y-2 text-muted-foreground text-xs leading-5">
				<li className="flex gap-2">
					<CheckIcon
						className={cn(
							"mt-0.5 size-3.5 shrink-0",
							resolveStatusToneIconClassName("ready")
						)}
					/>
					<span>Read the current OpenMeld Skill.</span>
				</li>
				<li className="flex gap-2">
					<CheckIcon
						className={cn(
							"mt-0.5 size-3.5 shrink-0",
							resolveStatusToneIconClassName("ready")
						)}
					/>
					<span>Install or upgrade OpenMeld CLI and OpenMeld Skill.</span>
				</li>
				<li className="flex gap-2">
					<CheckIcon
						className={cn(
							"mt-0.5 size-3.5 shrink-0",
							resolveStatusToneIconClassName("ready")
						)}
					/>
					<span>Set up OpenMeld Service and detected local agents.</span>
				</li>
				<li className="flex gap-2">
					<CheckIcon
						className={cn(
							"mt-0.5 size-3.5 shrink-0",
							resolveStatusToneIconClassName("ready")
						)}
					/>
					<span>Create and operate Spaces with OpenMeld CLI.</span>
				</li>
			</ul>
		</section>
	);
}

function PromptExpiryStatus(input: { remainingSeconds: number | null }) {
	if (input.remainingSeconds === null) {
		return null;
	}

	if (input.remainingSeconds <= 0) {
		return (
			<p
				className={cn(
					"ml-auto text-right text-xs leading-5",
					resolveStatusToneIconClassName("warning")
				)}
			>
				Expired. Refresh and copy to continue.
			</p>
		);
	}

	return (
		<p className="ml-auto text-right text-muted-foreground text-xs leading-5">
			Expires in {formatCountdown(input.remainingSeconds)}
		</p>
	);
}

function resolveGeneratePromptDescription(input: {
	hasGeneratedPrompt: boolean;
	isAuthenticated: boolean;
	isExpired: boolean;
	isGenerating: boolean;
}) {
	if (input.isGenerating) {
		return "Creating a private handoff prompt with one-time setup access for this computer.";
	}
	if (!input.isAuthenticated) {
		return "Sign in to create a private, expiring setup prompt. It includes one-time setup access for this computer; if it expires, return here and generate a new one.";
	}
	if (input.hasGeneratedPrompt && input.isExpired) {
		return "The current prompt has expired. Refresh it to create a new private setup prompt.";
	}
	if (input.hasGeneratedPrompt) {
		return "The current prompt is still valid. Refresh only if you want to rotate it or need a fresh expiry.";
	}
	return "Creates a private prompt for your agent with one-time setup access for this computer. It expires; generate a fresh one if the command expires or the agent still cannot finish setup.";
}

function resolveGenerateActionLabel(input: {
	hasGeneratedPrompt: boolean;
	isExpired: boolean;
}): string {
	if (!input.hasGeneratedPrompt) {
		return "Generate agent prompt";
	}
	if (input.isExpired) {
		return "Refresh expired prompt";
	}
	return "Refresh agent prompt";
}

function resolveCopyActionLabel(input: {
	copyState: "copied" | "idle";
	isExpired: boolean;
	pendingPromptAction: PromptActionKind | null;
}): string {
	if (input.pendingPromptAction === "copy") {
		return input.isExpired ? "Refreshing and copying…" : "Copying…";
	}
	if (input.isExpired) {
		return "Refresh and copy";
	}
	return input.copyState === "copied" ? "Copy again" : "Copy agent prompt";
}

function resolvePromptCopiedMessage(input: {
	didGenerateFreshPrompt: boolean;
	kind: PromptActionKind;
}): string {
	if (input.kind === "generate") {
		return "OpenMeld Agent Interface prompt generated and copied.";
	}
	return input.didGenerateFreshPrompt
		? "Fresh agent prompt copied."
		: "Agent prompt copied.";
}

function isPromptExpired(expiresAt: string, now: number): boolean {
	const remainingSeconds = resolveRemainingSeconds(expiresAt, now);
	return remainingSeconds === null || remainingSeconds <= 0;
}

function resolveRemainingSeconds(
	expiresAt: null | string,
	now: number
): number | null {
	if (!expiresAt) {
		return null;
	}
	const expiresAtMs = Date.parse(expiresAt);
	if (!Number.isFinite(expiresAtMs)) {
		return null;
	}
	return Math.max(0, Math.ceil((expiresAtMs - now) / 1000));
}

function formatCountdown(totalSeconds: number): string {
	const safeSeconds = Math.max(0, Math.floor(totalSeconds));
	const hours = Math.floor(safeSeconds / 3600);
	const minutes = Math.floor((safeSeconds % 3600) / 60);
	const seconds = safeSeconds % 60;

	if (hours > 0) {
		return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
	}
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function resolveSkillUrl(): string {
	if (typeof window === "undefined") {
		return OPENMELD_SKILL_PATH;
	}
	return new URL(OPENMELD_SKILL_PATH, window.location.origin).toString();
}

async function resolveBestHumanProfile(
	defaultHumanProfile:
		| ReturnType<typeof listActiveProfilesByKind>[number]
		| null
) {
	if (defaultHumanProfile) {
		return defaultHumanProfile;
	}
	const profiles = await listStartProfiles();
	return listActiveProfilesByKind(profiles ?? [], "human")[0] ?? null;
}

function resolveErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message;
	}
	return "OpenMeld could not generate the Agent Interface prompt.";
}
