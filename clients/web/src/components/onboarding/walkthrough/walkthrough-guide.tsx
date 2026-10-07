import {
	LARK_CHANNEL_IDENTITY,
	PLUGINS,
	SLACK_CHANNEL_IDENTITY,
} from "@openmeld/product-catalog/plugins";
import type { FirstWorkRecord, OrganizationSummary } from "@openmeld/schemas";
import { AppLogo } from "@openmeld/ui/components/app-logo";
import { Button } from "@openmeld/ui/components/button";
import { Popover, PopoverContent } from "@openmeld/ui/components/popover";
import { FluidCardGroup, FluidCardItem } from "@openmeld/ui/fluid/card";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowRightIcon, TimerIcon, XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { Joyride, type TooltipRenderProps } from "react-joyride";
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
import { useWalkthrough } from "./walkthrough-context";

// DOM discovery controls presentation only. Product success is observed by the
// owning surfaces, never inferred from clicks or the presence of a selector.
function useWalkthroughTarget(step: string | undefined) {
	const [target, setTarget] = useState<HTMLElement | null>(null);
	useEffect(() => {
		if (!step) {
			setTarget(null);
			return;
		}
		let frame = 0;
		const find = () => {
			let selectors = [
				'[data-walkthrough="conversation"] [data-slot="space-composer-section"]',
			];
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
				selectors
					.flatMap((selector) =>
						Array.from(document.querySelectorAll<HTMLElement>(selector))
					)
					.find((element) => element.getBoundingClientRect().height > 0) ??
				null;
			setTarget((previous) => (previous === found ? previous : found));
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
	return target;
}

function GuideTooltip({ step, tooltipProps }: TooltipRenderProps) {
	const guide = useWalkthrough();
	const { currentOrganization } = useAppOrganization();
	const navigate = useNavigate();
	const currentStep = guide?.record?.step;
	const optionalAgent =
		currentStep === "local-agent" || currentStep === "add-local-agent";
	let exitLabel = "Pause tutorial";
	let exitStep = currentStep;
	if (optionalAgent) {
		exitLabel = "Skip this step";
		exitStep = "options";
	} else if (currentStep === "options") {
		exitLabel = "Finish tutorial";
		exitStep = "complete";
	}
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
				<Button
					aria-label="Close tutorial"
					disabled={guide?.pending}
					onClick={() =>
						guide &&
						currentStep &&
						guide.progress(currentStep, true).catch(() => undefined)
					}
					size="icon-xs"
					type="button"
					variant="secondary"
				>
					<XIcon aria-hidden="true" />
				</Button>
			</div>
			<div className="mt-2 text-sm leading-relaxed">{step.content}</div>
			<p className="mt-3 text-muted-foreground text-xs">
				Continue or replay the tutorial from Help.
			</p>
			<div className="mt-4 flex flex-wrap justify-end gap-2">
				<Button
					disabled={guide?.pending}
					onClick={() =>
						guide &&
						exitStep &&
						guide
							.progress(exitStep, !(optionalAgent || currentStep === "options"))
							.catch(() => undefined)
					}
					size="sm"
					variant="secondary"
				>
					{exitLabel}
				</Button>
				{currentStep === "local-agent" && (
					<Button
						disabled={guide?.pending}
						onClick={async () => {
							await guide?.progress("add-local-agent");
							await navigate({
								to: buildOrganizationAgentCreationPath(
									currentOrganization.slug
								),
							});
						}}
						size="sm"
					>
						Connect agent
					</Button>
				)}
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

export function WalkthroughGuide() {
	const guide = useWalkthrough();
	const noticeAnchor = guide?.noticeAnchor;
	const record = guide?.record;
	const { currentOrganization: organization } = useAppOrganization();
	const location = useLocation();
	const onSpace = Boolean(
		record && location.pathname.endsWith(`/spaces/${record.spaceId}`)
	);
	const active = isActiveGuide(
		record ?? null,
		location.pathname,
		organization.slug
	);
	const target = useWalkthroughTarget(active ? record?.step : undefined);
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
	if (guide?.pauseNotice && record?.paused && noticeAnchor) {
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

	const pause = () => guide.progress(record.step, true).catch(() => undefined);
	// Configuration pages retain their complete accessible UI, including OAuth,
	// permissions, and local setup. Returning does not claim they were configured.
	if (!onSpace && record.step !== "create-space") {
		return noticeAnchor ? (
			<WalkthroughNotice anchor={noticeAnchor}>
				<p>Your progress is saved. Continue the tutorial from Help.</p>
				<div className="mt-3 flex flex-wrap justify-end gap-2">
					<Button
						onClick={() => guide.resume().catch(() => undefined)}
						size="sm"
					>
						Back to tutorial
					</Button>
					<Button
						disabled={guide.pending}
						onClick={pause}
						size="sm"
						variant="secondary"
					>
						Pause tutorial
					</Button>
				</div>
			</WalkthroughNotice>
		) : null;
	}
	if (
		(record.step === "local-agent" || record.step === "options") &&
		target?.isConnected
	) {
		return <WalkthroughChoices organization={organization} record={record} />;
	}

	// A route can mount before its controls. Missing DOM is not a paused run.
	// Let the owning page show loading/errors; Help remains the resume entry.
	if (!target?.isConnected) {
		return null;
	}
	const picker = target.dataset.walkthrough === "people-agent-picker";
	const content = guideCopy(record.step, target.dataset.walkthrough);
	// The real picker owns its description, preselection, actions, and focus.
	if (picker) {
		return null;
	}
	return (
		<Joyride
			key={`${record.step}:${target.dataset.walkthrough ?? target.getAttribute("aria-label")}`}
			options={{
				arrowColor: "var(--popover)",
				skipBeacon: true,
				disableFocusTrap: true,
				overlayClickAction: false,
				dismissKeyAction: false,
				scrollDuration: 0,
				skipScroll: record.step === "first-task",
				spotlightPadding: 6,
				zIndex: 40,
			}}
			run
			steps={[
				{
					target,
					spotlightTarget:
						record.step === "first-task"
							? (target.closest<HTMLElement>(
									'[data-walkthrough="conversation"]'
								) ?? target)
							: target,
					placement: record.step === "first-task" ? "top" : "auto",
					title: "Tutorial",
					content,
				},
			]}
			tooltipComponent={GuideTooltip}
		/>
	);
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
	const local = record.step === "local-agent";
	const { currentUserId } = useAppOrganization();
	const role = useQuery(
		organizationMemberRoleQueryOptions({
			enabled: !(local || organization.isPersonal),
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
					title: local ? "Connect your agent" : "What’s next?",
					content: (
						<>
							<p>
								{local
									? "Connect an agent on your computer to work in this Space."
									: "Choose an option, or finish the tutorial."}
							</p>
							{!local && (
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
							)}
							{!local && canManageTeam && (
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
