import {
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
} from "@openmeld/ui/components/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import {
	FluidActionList,
	FluidActionListItem,
} from "@openmeld/ui/fluid/action-list";
import {
	FluidDropdownMenuGroup,
	FluidDropdownMenuItem,
	FluidDropdownMenuSubContent,
	FluidDropdownMenuSubTrigger,
} from "@openmeld/ui/fluid/dropdown-menu";
import {
	ArrowCounterClockwiseIcon,
	ArrowUpRightIcon,
	BookOpenTextIcon,
	CompassIcon,
	GlobeHemisphereWestIcon,
	LifebuoyIcon,
	PlayIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useWalkthrough } from "#/components/onboarding/walkthrough/walkthrough-context";
import { readLatestChangelog } from "#/lib/changelog/read-latest-changelog";

const website = "https://openmeld.ai";
const changelogUrl = `${website}/changelog`;
const dateFormat = new Intl.DateTimeFormat("en-GB", {
	day: "numeric",
	month: "short",
	timeZone: "UTC",
});

function HelpLink({
	children,
	href,
	index,
}: {
	children: ReactNode;
	href: string;
	index: number;
}) {
	return (
		<DropdownMenuItem
			className="gap-2 focus:bg-transparent"
			nativeButton={false}
			render={
				<FluidActionListItem
					index={index}
					render={
						<a href={href} rel="noopener noreferrer" target="_blank">
							{children}
						</a>
					}
				/>
			}
		>
			{children}
		</DropdownMenuItem>
	);
}

function TimelineDot({ last = false }: { last?: boolean }) {
	return (
		<span
			aria-hidden="true"
			className="relative flex size-4 shrink-0 items-center justify-center self-center"
		>
			<span className="size-1.5 rounded-full border border-muted-foreground" />
			{!last && (
				<span className="absolute top-3 left-1/2 h-6 w-px -translate-x-1/2 bg-border" />
			)}
		</span>
	);
}

export function AppHelpMenu({ index }: { index: number }) {
	const [open, setOpen] = useState(false);
	const changelog = useQuery({
		queryKey: ["changelog", "production", "latest", 3],
		enabled: open,
		staleTime: 300_000,
		gcTime: 1_800_000,
		retry: false,
		queryFn: () => readLatestChangelog(),
	});
	return (
		<DropdownMenuSub onOpenChange={setOpen} open={open}>
			<FluidDropdownMenuSubTrigger index={index}>
				<LifebuoyIcon />
				Help
			</FluidDropdownMenuSubTrigger>
			<FluidDropdownMenuSubContent
				className="w-[420px] max-w-[calc(100vw-24px)]"
				sideOffset={6}
			>
				<div className="px-2 py-1.5 text-muted-foreground text-xs">
					What's new
				</div>
				<FluidDropdownMenuGroup>
					{changelog.data?.map((entry, entryIndex) => (
						<HelpLink
							href={`${changelogUrl}#update-${entry.id}`}
							index={entryIndex}
							key={entry.id}
						>
							<TimelineDot />
							<span className="min-w-0 flex-1 truncate" title={entry.title}>
								{entry.title}
							</span>
							<time
								className="shrink-0 text-muted-foreground"
								dateTime={entry.publishedAt}
							>
								{dateFormat.format(new Date(`${entry.publishedAt}T00:00:00Z`))}
							</time>
						</HelpLink>
					))}
					{!changelog.data && (
						<output className="px-2 py-2 text-muted-foreground text-xs">
							{changelog.isError
								? "Updates couldn't load. View the full changelog below."
								: "Loading updates…"}
						</output>
					)}
					<HelpLink href={changelogUrl} index={3}>
						<TimelineDot last />
						<span className="flex-1">Full changelog</span>
						<ArrowUpRightIcon className="text-muted-foreground" />
					</HelpLink>
				</FluidDropdownMenuGroup>
				<DropdownMenuSeparator />
				<FluidDropdownMenuGroup>
					<HelpLink href={website} index={0}>
						<GlobeHemisphereWestIcon />
						<span className="flex-1">OpenMeld website</span>
						<ArrowUpRightIcon className="text-muted-foreground" />
					</HelpLink>
					<HelpLink href="https://docs.openmeld.ai" index={1}>
						<BookOpenTextIcon />
						<span className="flex-1">Documentation</span>
						<ArrowUpRightIcon className="text-muted-foreground" />
					</HelpLink>
				</FluidDropdownMenuGroup>
				<TutorialMenuActions />
			</FluidDropdownMenuSubContent>
		</DropdownMenuSub>
	);
}

function TutorialMenuActions() {
	const walkthrough = useWalkthrough();
	if (!walkthrough?.available) {
		return null;
	}
	const actions = [
		...(walkthrough.record && walkthrough.record.step !== "complete"
			? [
					{
						label: "Continue tutorial",
						icon: PlayIcon,
						run: walkthrough.resume,
					},
				]
			: []),
		{
			label: "Replay tutorial",
			icon: ArrowCounterClockwiseIcon,
			run: () => walkthrough.start(true),
		},
	];
	return (
		<div className="flex min-h-9 items-center gap-2 px-2 py-1 text-xs">
			<CompassIcon aria-hidden="true" className="size-4 shrink-0" />
			<span className="flex-1">Tutorial</span>
			<FluidActionList
				axis="x"
				className="flex w-fit flex-row gap-1"
				focusIndicatorClassName="z-0 border-0 bg-interaction-hover"
				hoverIndicatorClassName="bg-interaction-hover"
				role="presentation"
			>
				{actions.map(({ label, icon: Icon, run }, index) => (
					<Tooltip key={label}>
						<TooltipTrigger
							render={
								<FluidDropdownMenuItem
									aria-label={label}
									className="size-7 justify-center border border-border bg-transparent p-0 text-secondary-foreground"
									disabled={walkthrough.pending}
									index={index}
									onClick={() => run().catch(() => undefined)}
								/>
							}
						>
							<Icon aria-hidden="true" />
						</TooltipTrigger>
						<TooltipContent side="top">{label}</TooltipContent>
					</Tooltip>
				))}
			</FluidActionList>
		</div>
	);
}
