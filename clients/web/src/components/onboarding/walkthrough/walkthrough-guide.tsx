import {
	LARK_CHANNEL_IDENTITY,
	PLUGINS,
	SLACK_CHANNEL_IDENTITY,
} from "@openmeld/product-catalog/plugins";
import type { FirstWorkRecord, OrganizationSummary } from "@openmeld/schemas";
import { AppLogo } from "@openmeld/ui/components/app-logo";
import { Button } from "@openmeld/ui/components/button";
import { Popover, PopoverContent } from "@openmeld/ui/components/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { FluidCardGroup, FluidCardItem } from "@openmeld/ui/fluid/card";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowRightIcon, TimerIcon, XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import { Joyride, type TooltipRenderProps } from "react-joyride";
import { LocalAgentLogoStack } from "#/components/profiles/local-agent-logo-stack";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import {
	buildOrganizationAgentCreationPath,
	buildOrganizationChannelsPath,
	buildOrganizationPluginsPath,
	buildOrganizationRoutinesPath,
} from "#/lib/organizations/organization-routes";
import { buildSettingsRoutes } from "#/lib/settings-routes";
import { organizationMemberRoleQueryOptions } from "#/query/organizations/organization-directory";
import type { useWalkthroughSpaceProgress } from "./use-walkthrough-space-progress";
import { useWalkthrough } from "./walkthrough-context";

// DOM discovery controls presentation only. Product success is observed by the
// owning surfaces, never inferred from clicks or the presence of a selector.
function useWalkthroughTarget(step: string | undefined) {
	const [match, setMatch] = useState<{
		step: string;
		target: HTMLElement | null;
	} | null>(null);
	useEffect(() => {
		if (!step) {
			setMatch(null);
			return;
		}
		let frame = 0;
		const find = () => {
			let selectors = [
				'[data-walkthrough="conversation"] [aria-label="Send message"]',
			];
			if (step === "local-agent") {
				selectors = ['[aria-label^="Members"]'];
			}
			if (step === "review-replies" || step === "local-reply") {
				selectors = ['[data-walkthrough="conversation"] [role="log"]'];
			}
			if (step === "create-space") {
				selectors = [
					'[data-walkthrough="create-space-form"]',
					'[data-walkthrough="create-space"]',
				];
			} else if (step === "add-center-agent" || step === "add-local-agent") {
				selectors = [
					'[data-walkthrough="people-agent-picker"]',
					'[data-walkthrough="add-people-or-agents"]',
					'[aria-label="Add People or Agents"]',
					'[aria-label^="Members"]',
				];
			}
			const found =
				['[data-walkthrough="people-agent-picker"]', ...selectors]
					.flatMap((selector) =>
						Array.from(document.querySelectorAll<HTMLElement>(selector))
					)
					.find((element) => element.getBoundingClientRect().height > 0) ??
				null;
			setMatch((previous) =>
				previous?.step === step && previous.target === found
					? previous
					: { step, target: found }
			);
		};
		const observer = new MutationObserver(() => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(find);
		});
		find();
		observer.observe(document.body, { childList: true, subtree: true });
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
		};
	}, [step]);
	return match && match.step === step ? match.target : null;
}

const GuideActions = createContext<ReactNode>(undefined);

function TutorialPassButton() {
	const guide = useWalkthrough();
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						aria-label="Pass tutorial"
						disabled={guide?.pending}
						onClick={() =>
							guide?.record &&
							guide.progress(guide.record.step, true).catch(() => undefined)
						}
						size="icon-xs"
						type="button"
						variant="secondary"
					>
						<XIcon aria-hidden="true" />
					</Button>
				}
			/>
			<TooltipContent>Pass</TooltipContent>
		</Tooltip>
	);
}

function tutorialStepNumber(step: string | undefined) {
	switch (step) {
		case "create-space":
			return 1;
		case "add-center-agent":
			return 2;
		case "first-task":
			return 3;
		case "local-agent":
		case "add-local-agent":
		case "local-task":
			return 4;
		case "review-replies":
			return 5;
		case "options":
			return 6;
		default:
			return null;
	}
}

function GuideTooltip({ step, tooltipProps }: TooltipRenderProps) {
	const actions = useContext(GuideActions);
	const guide = useWalkthrough();
	const currentStep = guide?.record?.step;
	const stepNumber = tutorialStepNumber(currentStep);
	return (
		<section
			{...tooltipProps}
			aria-modal={false}
			className={cn(
				"max-w-[calc(100vw-32px)] rounded-md border bg-popover p-4 text-popover-foreground shadow-md",
				currentStep === "options" ? "w-[720px] sm:p-5" : "w-80"
			)}
			role="dialog"
		>
			<div className="flex items-start justify-between gap-4">
				<h2 className="font-medium text-sm">{step.title}</h2>
				<TutorialPassButton />
			</div>
			<div className="mt-2 text-sm leading-relaxed">{step.content}</div>
			<div className="mt-4 flex flex-wrap items-center justify-between gap-2">
				<span className="text-muted-foreground text-xs">
					{stepNumber ? `Step ${stepNumber} of 6` : null}
				</span>
				<div className="ml-auto flex flex-wrap justify-end gap-2">
					{actions ??
						(currentStep === "options" && (
							<Button
								disabled={guide?.pending}
								onClick={() =>
									guide?.progress("complete").catch(() => undefined)
								}
								size="sm"
							>
								Finish tutorial
							</Button>
						))}
				</div>
			</div>
		</section>
	);
}

function isActiveGuide(
	record: FirstWorkRecord | null,
	pathname: string,
	orgSlug: string
) {
	if (!record || record.paused || record.step === "complete") {
		return false;
	}
	if (record.step === "create-space") {
		return pathname === `/o/${orgSlug}/new-space`;
	}
	if (pathname === `/o/${orgSlug}/spaces/${record.spaceId}`) {
		return true;
	}
	const onSetupPage = [
		buildOrganizationAgentCreationPath(orgSlug),
		buildOrganizationChannelsPath(orgSlug),
		buildOrganizationPluginsPath(orgSlug),
		buildOrganizationRoutinesPath(orgSlug),
		buildSettingsRoutes(orgSlug).invitations,
		buildSettingsRoutes(orgSlug)["center-agent"],
	].some((path) => pathname === path || pathname.startsWith(`${path}/`));
	const optionalStep =
		record?.step === "local-agent" ||
		record?.step === "add-local-agent" ||
		record?.step === "options";
	return optionalStep && onSetupPage;
}

function WalkthroughNotice({
	anchor,
	children,
}: {
	anchor: HTMLElement;
	children: ReactNode;
}) {
	return (
		<Popover modal={false} open>
			<PopoverContent
				align="end"
				anchor={anchor}
				aria-label="Tutorial"
				className="w-80 max-w-[calc(100vw-80px)] rounded-md border p-3 text-sm data-closed:animate-none data-open:animate-none [body:has(#walkthrough-notice-anchor.hidden)_&]:hidden"
				finalFocus={false}
				initialFocus={false}
				side="right"
				sideOffset={0}
			>
				{children}
			</PopoverContent>
		</Popover>
	);
}

function usePauseOnEscape(
	active: boolean,
	record: FirstWorkRecord | null | undefined,
	guide: ReturnType<typeof useWalkthrough>
) {
	useEffect(() => {
		if (!(active && record)) {
			return;
		}
		const onKey = (event: KeyboardEvent) => {
			if (
				event.key === "Escape" &&
				!event.defaultPrevented &&
				!document.querySelector('[data-walkthrough="people-agent-picker"]')
			) {
				guide?.progress(record.step, true).catch(() => undefined);
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [active, record, guide]);
}

export function WalkthroughGuide({
	spaceProgress,
	onConnectAgent,
	onAddAgents,
}: {
	spaceProgress?: ReturnType<typeof useWalkthroughSpaceProgress>;
	onConnectAgent?: () => void;
	onAddAgents?: () => void;
} = {}) {
	const guide = useWalkthrough();
	const noticeAnchor = guide?.noticeAnchor;
	const record = guide?.record;
	const { currentOrganization: organization } = useAppOrganization();
	const location = useLocation();
	const onSpace = Boolean(
		record && location.pathname.endsWith(`/spaces/${record.spaceId}`)
	);
	const active =
		(!onSpace || Boolean(spaceProgress)) &&
		isActiveGuide(record ?? null, location.pathname, organization.slug);
	const showingLocalReply =
		record?.step === "local-task" && spaceProgress?.localSent;
	const targetStep = showingLocalReply ? "local-reply" : record?.step;
	const target = useWalkthroughTarget(active ? targetStep : undefined);
	usePauseOnEscape(active, record, guide);
	if (!spaceProgress && guide?.pauseNotice && record?.paused && noticeAnchor) {
		return (
			<WalkthroughNotice anchor={noticeAnchor}>
				<div className="flex items-start gap-3">
					<output className="flex-1">
						Tutorial paused. Open your user menu → Help to continue.
					</output>
					<Button
						aria-label="Dismiss tutorial reminder"
						onClick={guide.dismissPauseNotice}
						size="icon-xs"
						type="button"
						variant="secondary"
					>
						<XIcon aria-hidden="true" />
					</Button>
				</div>
			</WalkthroughNotice>
		);
	}
	if (!(active && guide && record)) {
		return null;
	}

	// Configuration pages retain their complete accessible UI, including OAuth,
	// permissions, and local setup. Returning does not claim they were configured.
	if (!onSpace && record.step !== "create-space") {
		return noticeAnchor ? (
			<WalkthroughNotice anchor={noticeAnchor}>
				<div className="flex items-start justify-between gap-3">
					<p>Your progress is saved. Continue the tutorial from Help.</p>
					<TutorialPassButton />
				</div>
				<div className="mt-3 flex flex-wrap justify-end gap-2">
					<Button
						onClick={() => guide.resume().catch(() => undefined)}
						size="sm"
					>
						Back to tutorial
					</Button>
				</div>
			</WalkthroughNotice>
		) : null;
	}
	if (record.step === "options" && target?.isConnected) {
		return <WalkthroughChoices organization={organization} record={record} />;
	}

	// A route can mount before its controls. Missing DOM is not a paused run.
	// Let the owning page show loading/errors; Help remains the resume entry.
	if (!target?.isConnected) {
		return null;
	}
	const picker = target.dataset.walkthrough === "people-agent-picker";
	// Keep the guide inside the modal's focus boundary. The picker still owns
	// selection and submission; its public anchors only control presentation.
	if (picker) {
		return <PickerGuide picker={target} />;
	}
	// Membership can refresh before saved progress. Never briefly redisplay the
	// old Members instruction after the user has already added their agent.
	if (awaitingLocalStep(record.step, spaceProgress)) {
		return null;
	}
	const { content, actions, title, composing } = spaceGuidePresentation(
		record,
		target.dataset.walkthrough,
		spaceProgress,
		guide,
		onConnectAgent,
		onAddAgents
	);
	return (
		<GuidedTarget
			actions={actions}
			composing={composing}
			content={content}
			key={record.step}
			target={target}
			title={title}
		/>
	);
}

function PickerGuide({ picker }: { picker: HTMLElement }) {
	const [presentation, setPresentation] = useState(() => ({
		action: picker.dataset.tutorialAction,
		content: picker.dataset.tutorialDescription,
	}));
	useEffect(() => {
		const observer = new MutationObserver(() =>
			setPresentation({
				action: picker.dataset.tutorialAction,
				content: picker.dataset.tutorialDescription,
			})
		);
		observer.observe(picker, {
			attributes: true,
			attributeFilter: ["data-tutorial-action", "data-tutorial-description"],
		});
		return () => observer.disconnect();
	}, [picker]);
	const action = presentation.action;
	const anchor = action
		? picker.querySelector<HTMLElement>(`[data-tutorial-target="${action}"]`)
		: null;
	if (!anchor) {
		return null;
	}
	return (
		<GuidedTarget
			actions={null}
			composing={false}
			content={presentation.content}
			portalElement={picker}
			target={anchor}
			title="Tutorial"
		/>
	);
}

function awaitingLocalStep(
	step: string,
	progress: ReturnType<typeof useWalkthroughSpaceProgress> | undefined
) {
	return step === "add-local-agent" && Boolean(progress?.local);
}

function GuidedTarget({
	target,
	composing,
	title,
	content,
	actions,
	portalElement,
}: {
	target: HTMLElement;
	composing: boolean;
	title: string;
	content: ReactNode;
	actions: ReactNode;
	portalElement?: HTMLElement;
}) {
	const anchor = composing
		? (target.closest<HTMLElement>('[data-slot="space-composer-section"]') ??
			target)
		: target;
	return (
		<GuideActions.Provider value={actions}>
			<Joyride
				options={{
					arrowColor: "var(--popover)",
					skipBeacon: true,
					disableFocusTrap: true,
					overlayClickAction: false,
					dismissKeyAction: false,
					scrollDuration: 0,
					skipScroll: true,
					spotlightPadding: 6,
					zIndex: 40,
				}}
				portalElement={portalElement}
				run
				steps={[
					{
						target: anchor,
						spotlightTarget: anchor,
						placement: guidePlacement(target, composing),
						floatingOptions: { shiftOptions: { crossAxis: true, padding: 12 } },
						title,
						content,
					},
				]}
				styles={{
					// Positioning can reset while a target or its portal changes. Do
					// not fade stale coordinates through the next frame.
					floater: { transition: "none" },
					...(portalElement ? { overlay: { position: "fixed" as const } } : {}),
				}}
				tooltipComponent={GuideTooltip}
			/>
		</GuideActions.Provider>
	);
}

function guidePlacement(target: HTMLElement, composing: boolean) {
	if (composing) {
		return "top-end" as const;
	}
	return target.getAttribute("role") === "log"
		? ("bottom-end" as const)
		: ("auto" as const);
}

function localTaskCopy(sent: boolean, replied: boolean) {
	if (!sent) {
		return "A short message is ready. Select Send to try your local agent.";
	}
	return replied
		? "Your agent replied. Read its message below."
		: "Your message is sent. Replies and any errors appear in this conversation.";
}

function spaceGuidePresentation(
	record: FirstWorkRecord,
	targetName: string | undefined,
	spaceProgress: ReturnType<typeof useWalkthroughSpaceProgress> | undefined,
	guide: NonNullable<ReturnType<typeof useWalkthrough>>,
	onConnectAgent?: () => void,
	onAddAgents?: () => void
) {
	const showingLocalReply =
		record.step === "local-task" && spaceProgress?.localSent;
	let content: ReactNode = guideCopy(record.step, targetName);
	let actions: ReactNode;
	let title = "Tutorial";
	const advance = (step: Parameters<typeof guide.progress>[0]) => () =>
		guide.progress(step).catch(() => undefined);
	if (record.step === "local-agent") {
		title = "Try an agent on your computer";
		content = (
			<>
				<p>
					Your message is sent. While your Center Agent replies, you can connect
					a local agent.
				</p>
				<div className="mt-3">
					<LocalAgentLogoStack />
				</div>
				<p className="mt-2 text-muted-foreground text-xs">
					Codex, Claude Code, and more.
				</p>
			</>
		);
		actions = (
			<Button
				disabled={guide.pending}
				onClick={() => {
					guide
						.progress(spaceProgress?.local ? "local-task" : "add-local-agent")
						.then(() => onConnectAgent?.())
						.catch(() => undefined);
				}}
				size="sm"
			>
				Connect an agent
			</Button>
		);
	}
	if (record.step === "add-local-agent" || record.step === "add-center-agent") {
		if (record.step === "add-local-agent") {
			content = "Select + or Next to add your agent.";
		}
		actions = (
			<Button
				disabled={guide.pending || !onAddAgents}
				onClick={onAddAgents}
				size="sm"
			>
				Next
			</Button>
		);
	}
	if (record.step === "local-task") {
		title = showingLocalReply ? "Your local agent" : "Say hello to your agent";
		content = localTaskCopy(
			Boolean(showingLocalReply),
			Boolean(spaceProgress?.localReplied)
		);
		actions = showingLocalReply && (
			<Button
				disabled={guide.pending}
				onClick={advance("review-replies")}
				size="sm"
			>
				Next
			</Button>
		);
	}
	if (record.step === "review-replies") {
		title = "Your first conversation";
		content = spaceProgress?.centerReplied
			? "Your Center Agent replied. Read its message, then continue when you’re ready."
			: "Your message is sent. Replies and any errors appear here. You can keep exploring.";
		actions = (
			<Button disabled={guide.pending} onClick={advance("options")} size="sm">
				{spaceProgress?.centerReplied ? "Continue" : "Explore next steps"}
			</Button>
		);
	}
	const composing =
		record.step === "first-task" ||
		(record.step === "local-task" && !showingLocalReply);
	if (record.step === "first-task" && spaceProgress?.centerSent) {
		content = "Message sent. Next, you can try a local agent.";
	}

	return { content, actions, title, composing };
}

function guideCopy(step: string, target: string | undefined) {
	if (step === "create-space") {
		return target === "create-space-form"
			? "Keep this name or enter your own, then select Create."
			: "Select Create a Space to start working with your agents.";
	}
	if (step === "add-center-agent") {
		return "Select Add people or agents to add your Center Agent.";
	}
	if (step === "add-local-agent") {
		return "Select Add people or agents, then choose your agent.";
	}
	return "Your message is ready. Select Send to meet your Center Agent.";
}

function WalkthroughLogoStack({
	apps,
}: {
	apps: readonly { service: string; logoPath: string }[];
}) {
	return (
		<span className="isolate flex -space-x-2">
			{apps.map((app) => (
				<AppLogo
					app={app}
					className="relative size-8 rounded-full ring-2 ring-card"
					key={app.service}
					size="sm"
					surfaceLevel={3}
				/>
			))}
		</span>
	);
}

function WalkthroughChoices({
	record,
	organization,
}: {
	record: FirstWorkRecord;
	organization: OrganizationSummary;
}) {
	const navigate = useNavigate();
	const { currentUserId } = useAppOrganization();
	const role = useQuery(
		organizationMemberRoleQueryOptions({
			enabled: !organization.isPersonal,
			organizationId: organization.id,
			userId: currentUserId,
		})
	);
	const canConnectChannels =
		!organization.isPersonal &&
		canManageOrganizationArea(role.data, { channel: ["connect"] });
	const canManageTeam =
		!organization.isPersonal &&
		canManageOrganizationArea(role.data, {
			invitation: ["create"],
			centerAgent: ["update"],
		});
	const canManageSharedPlugins =
		!organization.isPersonal &&
		canManageOrganizationArea(role.data, { connector: ["manage"] });
	const actions = [
		...(canConnectChannels
			? [
					{
						label: "Channels",
						description: "Chat with your agent in Slack or Lark.",
						icon: (
							<WalkthroughLogoStack
								apps={[SLACK_CHANNEL_IDENTITY, LARK_CHANNEL_IDENTITY]}
							/>
						),
						path: buildOrganizationChannelsPath(organization.slug),
					},
				]
			: []),
		{
			label: "Plugins",
			description: "Give your agent access to your tools.",
			icon: (
				<WalkthroughLogoStack
					apps={PLUGINS.filter(
						(plugin) =>
							plugin.availability === "available" &&
							["github", "googledrive", "gmail"].includes(plugin.service)
					)}
				/>
			),
			path: buildOrganizationPluginsPath(organization.slug),
		},
		{
			label: "Routines",
			description: "Let your agent run tasks on a schedule.",
			icon: <TimerIcon aria-hidden="true" className="size-7" />,
			path: buildOrganizationRoutinesPath(organization.slug),
		},
	];
	return (
		<Joyride
			key={record.step}
			options={{
				skipBeacon: true,
				overlayClickAction: false,
				dismissKeyAction: false,
				scrollDuration: 0,
			}}
			run
			steps={[
				{
					target: "body",
					placement: "center",
					title: "What’s next?",
					content: (
						<>
							<p>Choose an option, or finish the tutorial.</p>
							{
								<FluidCardGroup
									className={cn(
										"mt-4 grid grid-cols-1 gap-3",
										canConnectChannels ? "sm:grid-cols-3" : "sm:grid-cols-2"
									)}
								>
									{actions.map((action) => (
										<FluidCardItem
											className="border"
											itemId={action.label}
											key={action.path}
										>
											<button
												className="flex h-full w-full flex-col items-start rounded-md p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
												onClick={async () => {
													if (action.label === "Plugins") {
														await navigate({
															to: "/o/$orgSlug/plugins",
															params: { orgSlug: organization.slug },
															search: {
																scope: canManageSharedPlugins
																	? "organization"
																	: "personal",
															},
														});
														return;
													}
													await navigate({ to: action.path });
												}}
												type="button"
											>
												<span className="mb-4 flex h-8 items-center gap-2">
													{action.icon}
												</span>
												<span className="flex w-full items-center justify-between gap-2 font-medium">
													{action.label}
													<ArrowRightIcon
														aria-hidden="true"
														className="size-4 text-muted-foreground"
													/>
												</span>
												<span className="mt-1 text-muted-foreground text-xs leading-5">
													{action.description}
												</span>
											</button>
										</FluidCardItem>
									))}
								</FluidCardGroup>
							}
							{canManageTeam && (
								<div className="mt-4 pt-4">
									<p className="font-medium">For your team</p>
									<p className="mt-1 text-muted-foreground text-xs">
										Invite teammates or tell your agent about your team.
									</p>
									<div className="mt-3 flex flex-wrap gap-2">
										<Button
											onClick={() =>
												navigate({
													to: "/o/$orgSlug/settings/invitations",
													params: { orgSlug: organization.slug },
													search: { requestId: undefined },
												})
											}
											size="sm"
											variant="secondary"
										>
											Invite people
										</Button>
										<Button
											onClick={() =>
												navigate({
													to: buildSettingsRoutes(organization.slug)[
														"center-agent"
													],
												})
											}
											size="sm"
											variant="secondary"
										>
											Team context
										</Button>
									</div>
								</div>
							)}
						</>
					),
				},
			]}
			tooltipComponent={GuideTooltip}
		/>
	);
}
