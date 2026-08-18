import type { OnboardingPlan } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { ProgressiveBlur } from "@openmeld/ui/components/progressive-blur";
import { FluidCardGroup, FluidCardItem } from "@openmeld/ui/fluid/card";
import { cardPickerCardClassName } from "@openmeld/ui/lib/card-picker-contract";
import { resolveStatusToneIconClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowRightIcon,
	LaptopIcon,
	RobotIcon,
	XIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useId } from "react";
import { SpaceCreateProfileButton } from "#/components/profiles/space-create-profile-button";
import { resolveOnboardingSetupActionVisibility } from "#/components/spaces/onboarding-setup-presentation";

const SETUP_BLUR_FADE_HEIGHT = "2rem";

type OnboardingDecision = OnboardingPlan["decisions"][number];
type OnboardingDecisionId = OnboardingDecision["id"];

export type OnboardingSetupBannerProps = {
	plan: OnboardingPlan;
	/** Opens the centralized "connect this computer" setup page. The OS-aware
	 * command + expiry + polling live there (same destination as the Agents
	 * page's "Connect OpenMeld Service"), not inline here — connecting is a multi-step
	 * Terminal flow, so it routes out rather than dumping a raw command in the
	 * conversation. */
	onConnect: () => void;
	onAddAgents?: () => void;
	/** Only used in-Space; passed to the create-first-agent launcher so a new
	 * agent joins this Space. The launcher creates the profile AND joins this
	 * Space, closing the "add your first agent" loop in place. */
	orgSlug: string;
	spaceId: string;
	spaceName: string | null;
	/** Decisions the user has dismissed this session (presentation-only). A
	 * dismissed row hides; a refresh or the header "Get set up" recall re-shows
	 * it, since dismissal is never persisted (Invariant 4/6). */
	dismissedIds: ReadonlySet<OnboardingDecisionId>;
	onDismiss: (id: OnboardingDecisionId) => void;
};

/**
 * In-Space onboarding guidance. A "Get set up" container of dismissible CTA
 * rows for the coarse next actions: connect this computer and bring agents.
 * Bring-agents acts in place (opens the Members panel); connect-this-computer
 * routes to the centralized Connect page, because connecting is a multi-step
 * Terminal flow that needs the OS-aware command + polling (onboarding.md
 * Invariant 8). Each row dismisses on its own ×; dismiss the last visible row
 * and the whole panel disappears (the header recall action brings it back). It
 * renders only available, non-dismissed actions, so a Space with nothing to do
 * shows nothing. Per-agent wakeability lives on the Members badge, not here:
 * this banner never says an agent "can be woken".
 */
export function OnboardingSetupBanner(props: OnboardingSetupBannerProps) {
	const onAddAgents = props.onAddAgents;
	const { bringAgentsFirstAgent, showBringAgents, showConnect } =
		resolveOnboardingSetupActionVisibility({
			canAddAgents: typeof onAddAgents === "function",
			dismissedIds: props.dismissedIds,
			plan: props.plan,
		});

	if (!(showConnect || showBringAgents)) {
		return null;
	}

	return (
		<section
			aria-label="Get set up"
			className="pointer-events-none relative shrink-0"
			data-slot="onboarding-setup-overlay"
		>
			<div
				className="relative mx-auto"
				data-space-conversation-content-width=""
			>
				<ProgressiveBlur
					blurAmount="6px"
					blurFadeHeight={SETUP_BLUR_FADE_HEIGHT}
					height={`calc(100% + ${SETUP_BLUR_FADE_HEIGHT})`}
				/>
				<div className="pointer-events-auto relative z-10 grid gap-1 py-3">
					<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0 px-2">
						<h2 className="font-medium text-foreground text-sm">Get set up</h2>
						<p className="text-muted-foreground text-xs">
							Optional. Dismiss anytime.
						</p>
					</div>

					{showConnect ? (
						<ConnectComputerAction
							onConnect={props.onConnect}
							onDismiss={() => props.onDismiss("connect_this_computer")}
						/>
					) : null}

					{showBringAgents && onAddAgents ? (
						<BringAgentsAction
							firstAgent={bringAgentsFirstAgent}
							onAddAgents={onAddAgents}
							onDismiss={() => props.onDismiss("bring_agents")}
							orgSlug={props.orgSlug}
							spaceId={props.spaceId}
							spaceName={props.spaceName}
						/>
					) : null}
				</div>
			</div>
		</section>
	);
}

export type OnboardingSetupEmptyStateActionsProps = Pick<
	OnboardingSetupBannerProps,
	"onAddAgents" | "onConnect" | "plan"
>;

/**
 * Setup entry points for an ordinary Space with no messages. The cards use the
 * same planner interpretation and action handlers as the banner; only their
 * presentation changes. FluidCard owns the single shared hover/focus
 * background, including its reduced-motion behavior.
 */
export function OnboardingSetupEmptyStateActions(
	props: OnboardingSetupEmptyStateActionsProps
) {
	const { showBringAgents, showConnect } =
		resolveOnboardingSetupActionVisibility({
			canAddAgents: typeof props.onAddAgents === "function",
			plan: props.plan,
		});

	if (!(showConnect || showBringAgents)) {
		return null;
	}

	return (
		<FluidCardGroup
			aria-label="Set up this Space"
			className={cn(
				"grid w-full gap-3",
				showConnect && showBringAgents ? "sm:grid-cols-2" : "mx-auto max-w-sm"
			)}
			role="group"
		>
			{showConnect ? (
				<EmptyStateSetupActionCard
					description="Bring Codex, Claude Code, or another local agent into OpenMeld. Then add it to this Space."
					icon={<LaptopIcon aria-hidden="true" className="size-5" />}
					itemId="connect-this-computer"
					onClick={props.onConnect}
					title="Connect this computer"
				/>
			) : null}

			{showBringAgents && props.onAddAgents ? (
				<EmptyStateSetupActionCard
					description="Choose an available agent—or create one—and add it to this Space."
					icon={<RobotIcon aria-hidden="true" className="size-5" />}
					itemId="add-agents"
					onClick={props.onAddAgents}
					title="Add agents"
				/>
			) : null}
		</FluidCardGroup>
	);
}

function EmptyStateSetupActionCard(input: {
	description: string;
	icon: ReactNode;
	itemId: string;
	onClick: () => void;
	title: string;
}) {
	const accessibleId = useId();
	const descriptionId = `${accessibleId}-description`;
	const titleId = `${accessibleId}-title`;

	return (
		<FluidCardItem className="bg-transparent" itemId={input.itemId}>
			<button
				aria-describedby={descriptionId}
				aria-labelledby={titleId}
				className={cn(
					cardPickerCardClassName(),
					"min-h-36 justify-between gap-5 bg-transparent p-4 hover:bg-transparent focus-visible:ring-inset"
				)}
				onClick={input.onClick}
				type="button"
			>
				<span className="flex w-full items-start justify-between gap-4">
					<span className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-background text-foreground">
						{input.icon}
					</span>
					<ArrowRightIcon
						aria-hidden="true"
						className="mt-1 size-4 shrink-0 text-muted-foreground"
					/>
				</span>
				<span className="grid gap-1.5">
					<span className="font-medium text-foreground text-sm" id={titleId}>
						{input.title}
					</span>
					<span
						className="text-muted-foreground text-xs leading-5"
						id={descriptionId}
					>
						{input.description}
					</span>
				</span>
			</button>
		</FluidCardItem>
	);
}

function DismissRowButton(input: { label: string; onDismiss: () => void }) {
	return (
		<Button
			aria-label={input.label}
			className="shrink-0 text-muted-foreground"
			onClick={input.onDismiss}
			size="icon-sm"
			type="button"
			variant="ghost"
		>
			<XIcon aria-hidden="true" className="size-4" />
		</Button>
	);
}

function SetupActionRow(input: {
	action: ReactNode;
	description: string;
	dismissLabel: string;
	icon: ReactNode;
	onDismiss: () => void;
	title: string;
}) {
	return (
		<div
			className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-2 py-1.5 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:items-center"
			data-slot="onboarding-setup-action"
		>
			{input.icon}
			<div className="grid min-w-0 gap-0.5">
				<p className="font-medium text-foreground text-sm">{input.title}</p>
				<p className="text-muted-foreground text-xs">{input.description}</p>
			</div>
			<div className="col-start-2 col-end-4 row-start-2 justify-self-start sm:col-start-3 sm:col-end-4 sm:row-start-1 sm:justify-self-end">
				{input.action}
			</div>
			<div className="col-start-3 row-start-1 sm:col-start-4">
				<DismissRowButton
					label={input.dismissLabel}
					onDismiss={input.onDismiss}
				/>
			</div>
		</div>
	);
}

function ConnectComputerAction(input: {
	onConnect: () => void;
	onDismiss: () => void;
}) {
	return (
		<SetupActionRow
			action={
				<Button
					onClick={input.onConnect}
					size="xs"
					type="button"
					variant="outline"
				>
					Connect OpenMeld Service
				</Button>
			}
			description="So your local agents can reply when you mention them."
			dismissLabel="Dismiss connect this computer"
			icon={
				<LaptopIcon
					aria-hidden="true"
					className={cn(
						"mt-0.5 size-4 shrink-0 sm:mt-0",
						resolveStatusToneIconClassName("warning")
					)}
				/>
			}
			onDismiss={input.onDismiss}
			title="Connect this computer"
		/>
	);
}

function BringAgentsAction(input: {
	firstAgent: boolean;
	onAddAgents: () => void;
	onDismiss: () => void;
	orgSlug: string;
	spaceId: string;
	spaceName: string | null;
}) {
	// First-agent variant: a brand-new user with no agent profile yet. The action
	// is "create an agent", not "add an existing one to this Space", so it opens
	// the self-contained Create-Profile launcher in place (creating the profile
	// AND joining this Space), not the Members panel.
	const title = input.firstAgent ? "Add your first agent" : "Bring your agents";
	const description = input.firstAgent
		? "Create an agent, then bring it into this Space."
		: "Add an agent to this Space";
	const dismissLabel = input.firstAgent
		? "Dismiss add your first agent"
		: "Dismiss bring your agents";
	return (
		<SetupActionRow
			action={
				input.firstAgent ? (
					<SpaceCreateProfileButton
						orgSlug={input.orgSlug}
						spaceId={input.spaceId}
						spaceName={input.spaceName}
					/>
				) : (
					<Button
						onClick={input.onAddAgents}
						size="xs"
						type="button"
						variant="outline"
					>
						Add agents
					</Button>
				)
			}
			description={description}
			dismissLabel={dismissLabel}
			icon={
				<RobotIcon
					aria-hidden="true"
					className={cn(
						"mt-0.5 size-4 shrink-0 sm:mt-0",
						resolveStatusToneIconClassName("warning")
					)}
				/>
			}
			onDismiss={input.onDismiss}
			title={title}
		/>
	);
}
