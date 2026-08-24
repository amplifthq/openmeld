import { Button } from "@openmeld/ui/components/button";
import { Calendar } from "@openmeld/ui/components/calendar";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@openmeld/ui/components/popover";
import {
	SharedLayoutGroup,
	SharedLayoutItem,
} from "@openmeld/ui/fluid/shared-layout-group";
import {
	CalendarBlankIcon,
	CaretDownIcon,
	CaretLeftIcon,
} from "@phosphor-icons/react";
import { useMessageScroller } from "@shadcn/react/message-scroller";
import { useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { Marker, MarkerContent } from "./primitives/marker";

const SAME_YEAR_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	month: "long",
	weekday: "long",
});
const OTHER_YEAR_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	month: "long",
	weekday: "long",
	year: "numeric",
});

type ConversationDatePreset = {
	date: Date;
	label: string;
};

type PendingConversationDateScroll = {
	loadedSignalCountAtRequest: number;
	targetSignalId: string;
};

const CONVERSATION_DATE_PILL_CLASS_NAME =
	"inline-flex h-8 max-lg:h-11 items-center justify-center gap-1.5 rounded-full border border-border bg-popover/60 px-3 font-medium text-foreground shadow-xs backdrop-blur-sm transition-colors hover:bg-popover/80 aria-expanded:bg-popover/80 dark:bg-popover/60 dark:hover:bg-popover/80 dark:aria-expanded:bg-popover/80 motion-reduce:transition-none";

export function SpaceConversationDateMarker(input: {
	date: Date;
	loadedSignalCount: number;
	onJumpToDate?: (date: Date) => Promise<string | null>;
	stuck?: boolean;
}) {
	const label = formatConversationDateLabel(input.date);

	return (
		<Marker
			aria-label={`Messages from ${label}`}
			className="h-12 py-2 max-lg:py-0.5"
			role="separator"
			variant="separator"
		>
			{input.stuck ? null : (
				<MarkerContent data-conversation-date-marker-pill="">
					<SpaceConversationDatePill
						date={input.date}
						loadedSignalCount={input.loadedSignalCount}
						onJumpToDate={input.onJumpToDate}
					/>
				</MarkerContent>
			)}
		</Marker>
	);
}

export function SpaceConversationDatePill(input: {
	date: Date;
	loadedSignalCount: number;
	onJumpToDate?: (date: Date) => Promise<string | null>;
}) {
	const label = formatConversationDateLabel(input.date);

	return input.onJumpToDate ? (
		<ConversationDateNavigation
			date={input.date}
			loadedSignalCount={input.loadedSignalCount}
			onJumpToDate={input.onJumpToDate}
		/>
	) : (
		<span className={CONVERSATION_DATE_PILL_CLASS_NAME}>{label}</span>
	);
}

function ConversationDateNavigation(input: {
	date: Date;
	loadedSignalCount: number;
	onJumpToDate: (date: Date) => Promise<string | null>;
}) {
	const messageScroller = useMessageScroller();
	const shouldReduceMotion = useReducedMotion();
	const [open, setOpen] = useState(false);
	const [showCalendar, setShowCalendar] = useState(false);
	const [isJumping, setIsJumping] = useState(false);
	const [navigationMessage, setNavigationMessage] = useState<string | null>(
		null
	);
	const pendingScrollRef = useRef<PendingConversationDateScroll | null>(null);
	const label = formatConversationDateLabel(input.date);
	const presets = buildConversationDatePresets(new Date());
	const scrollToDateTarget = useCallback(
		(targetSignalId: string) =>
			messageScroller.scrollToMessage(targetSignalId, {
				align: "center",
				behavior: shouldReduceMotion ? "auto" : "smooth",
			}),
		[messageScroller, shouldReduceMotion]
	);
	useEffect(() => {
		const pendingScroll = pendingScrollRef.current;
		if (
			!pendingScroll ||
			input.loadedSignalCount === pendingScroll.loadedSignalCountAtRequest
		) {
			return;
		}
		pendingScrollRef.current = null;
		if (scrollToDateTarget(pendingScroll.targetSignalId)) {
			setOpen(false);
		} else {
			setNavigationMessage(
				"Messages loaded, but this date could not be shown. Try again."
			);
		}
		setIsJumping(false);
	}, [input.loadedSignalCount, scrollToDateTarget]);

	const jumpToDate = async (date: Date) => {
		setIsJumping(true);
		setNavigationMessage(null);
		try {
			const targetSignalId = await input.onJumpToDate(date);
			if (!targetSignalId) {
				setNavigationMessage(
					"No messages are available on or after this date."
				);
				setIsJumping(false);
				return;
			}
			if (scrollToDateTarget(targetSignalId)) {
				setOpen(false);
				setIsJumping(false);
				return;
			}
			pendingScrollRef.current = {
				loadedSignalCountAtRequest: input.loadedSignalCount,
				targetSignalId,
			};
		} catch {
			// The conversation-level error banner preserves the structured failure.
			pendingScrollRef.current = null;
			setIsJumping(false);
		}
	};

	return (
		<Popover
			modal={false}
			onOpenChange={(nextOpen) => {
				setOpen(nextOpen);
				if (!nextOpen) {
					setShowCalendar(false);
					setNavigationMessage(null);
				}
			}}
			open={open}
		>
			<PopoverTrigger
				render={
					<Button
						aria-label={`Open date navigation for ${label}`}
						className={CONVERSATION_DATE_PILL_CLASS_NAME}
						size="sm"
						variant="outline"
					/>
				}
			>
				<span>{label}</span>
				<CaretDownIcon aria-hidden="true" />
			</PopoverTrigger>
			<PopoverContent
				align="center"
				aria-busy={isJumping}
				className="w-[min(20rem,calc(100vw-2rem))] gap-0 overflow-hidden rounded-xl p-0 motion-reduce:animate-none"
				sideOffset={8}
			>
				{showCalendar ? (
					<>
						<div className="flex min-h-11 items-center gap-2 border-border border-b px-2">
							<Button
								aria-label="Back to date shortcuts"
								disabled={isJumping}
								onClick={() => setShowCalendar(false)}
								size="icon-sm"
								type="button"
								variant="ghost"
							>
								<CaretLeftIcon aria-hidden="true" />
							</Button>
							<p className="font-medium text-sm">Choose a date</p>
						</div>
						<Calendar
							classNames={{ root: "w-full" }}
							defaultMonth={input.date}
							disabled={{ after: new Date() }}
							mode="single"
							onSelect={(date) => {
								if (date) {
									jumpToDate(date).catch(() => undefined);
								}
							}}
							selected={input.date}
						/>
					</>
				) : (
					<SharedLayoutGroup>
						<p className="px-3 pt-3 pb-1 font-medium text-muted-foreground text-xs">
							Jump to…
						</p>
						<div className="flex flex-col p-1.5">
							{presets.map((preset) => (
								<SharedLayoutItem
									itemId={`date-preset:${preset.label}`}
									key={preset.label}
								>
									<Button
										className="min-h-9 w-full justify-start px-2.5 font-normal text-sm hover:bg-transparent dark:hover:bg-transparent"
										disabled={isJumping}
										onClick={() => {
											jumpToDate(preset.date).catch(() => undefined);
										}}
										type="button"
										variant="ghost"
									>
										{preset.label}
									</Button>
								</SharedLayoutItem>
							))}
						</div>
						<div className="border-border border-t p-1.5">
							<SharedLayoutItem itemId="choose-specific-date">
								<Button
									className="min-h-9 w-full justify-start px-2.5 font-normal text-sm hover:bg-transparent dark:hover:bg-transparent"
									disabled={isJumping}
									onClick={() => setShowCalendar(true)}
									type="button"
									variant="ghost"
								>
									<CalendarBlankIcon aria-hidden="true" />
									Choose a date…
								</Button>
							</SharedLayoutItem>
						</div>
					</SharedLayoutGroup>
				)}
				{navigationMessage ? (
					<output className="border-border border-t px-3 py-2 text-muted-foreground text-xs">
						{navigationMessage}
					</output>
				) : null}
			</PopoverContent>
		</Popover>
	);
}

function formatConversationDateLabel(date: Date, now = new Date()) {
	if (isSameLocalCalendarDay(date, now)) {
		return "Today";
	}

	return date.getFullYear() === now.getFullYear()
		? SAME_YEAR_DATE_FORMAT.format(date)
		: OTHER_YEAR_DATE_FORMAT.format(date);
}

function buildConversationDatePresets(
	now: Date
): readonly ConversationDatePreset[] {
	return [
		{ date: startOfLocalDay(now), label: "Today" },
		{ date: addLocalDays(now, -1), label: "Yesterday" },
		{ date: addLocalDays(now, -7), label: "Last week" },
		{ date: addLocalMonths(now, -1), label: "Last month" },
		{ date: new Date(0), label: "The beginning" },
	];
}

function startOfLocalDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, amount: number): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function addLocalMonths(date: Date, amount: number): Date {
	const targetMonth = new Date(date.getFullYear(), date.getMonth() + amount, 1);
	const lastDayOfTargetMonth = new Date(
		targetMonth.getFullYear(),
		targetMonth.getMonth() + 1,
		0
	).getDate();
	return new Date(
		targetMonth.getFullYear(),
		targetMonth.getMonth(),
		Math.min(date.getDate(), lastDayOfTargetMonth)
	);
}

function isSameLocalCalendarDay(left: Date, right: Date): boolean {
	return (
		left.getFullYear() === right.getFullYear() &&
		left.getMonth() === right.getMonth() &&
		left.getDate() === right.getDate()
	);
}
