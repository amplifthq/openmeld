import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import {
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
} from "@openmeld/ui/fluid/sidebar-menu";
import { cn } from "@openmeld/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SidebarConversationTime } from "#/components/spaces/sidebar-conversation-time";
import { useNowMs } from "#/lib/spaces/use-now-ms";
import { useAppNavigationPresentation } from "./app-navigation-presentation";

export type SidebarNestedNavItem = {
	id: string;
	label: string;
	to: string;
	/** Last-message time, shown like the conversation rows' time. */
	timestamp?: number | null;
	/** Trailing marks, e.g. SpaceStatusIndicator. */
	accessory?: ReactNode;
	/** Include accessory meaning when the visible label alone is insufficient. */
	ariaLabel?: string;
};

/** A section's own row, e.g. a Profile above its chats. It is always a real
 *  row that navigates or acts, so nothing that looks like a row is inert. */
export type SidebarNestedNavSectionRow = {
	label: string;
	ariaLabel?: string;
	/** Drawn before the label, e.g. the Profile's avatar. */
	leading?: ReactNode;
	/** Where the row goes, e.g. the Profile's latest chat. */
	to?: string;
	/** What the row does when it has nowhere to go, e.g. start a chat. */
	onSelect?: () => void;
	disabled?: boolean;
};

export type SidebarNestedNavSection = {
	id: string;
	/** Names the section where a caller lists sections itself. */
	label?: string;
	/** With several sections, each section's items nest under this row. */
	row?: SidebarNestedNavSectionRow;
	/** Shown in place of the rows, e.g. a load failure. */
	notice?: ReactNode;
	items: readonly SidebarNestedNavItem[];
};

/**
 * Children of one sidebar row, indented under it and joined by the shared
 * sub-menu guide line, e.g. an Agent's chats under the Agent. Several
 * sections with their own rows nest one level deeper, e.g. Profile rows with
 * their chats under each. Renders inside the parent row's menu item so one
 * hover highlight moves between the parent and its children; a long list
 * scrolls inside its own max height.
 */
export function SidebarNestedNavList(input: {
	ariaLabel: string;
	activeItemId: string | null;
	sections: readonly SidebarNestedNavSection[];
	/** Aligns the guide line under the parent row's icon. */
	className?: string;
	maxHeightClassName?: string;
	/** Collapses the children under their parent row; defaults to open. */
	open?: boolean;
	/** For the parent row's toggle to reference with aria-controls. */
	id?: string;
}) {
	const nested =
		input.sections.length > 1 && input.sections.every((section) => section.row);
	return (
		<ScrollArea
			aria-label={input.ariaLabel}
			className={cn(
				input.open === false ? null : "mt-0.5",
				input.maxHeightClassName ?? "max-h-64"
			)}
			data-slot="sidebar-nested-nav-list"
			id={input.id}
			role="navigation"
		>
			<SidebarMenuSub
				className={cn("border-foreground/15", input.className)}
				open={input.open}
			>
				{nested
					? input.sections.map((section) => (
							<SectionRow
								activeItemId={input.activeItemId}
								key={section.id}
								section={section}
							/>
						))
					: // Without section rows the sections read as one list.
						input.sections.flatMap((section) =>
							sectionContent(section, input.activeItemId)
						)}
			</SidebarMenuSub>
		</ScrollArea>
	);
}

function SectionRow(input: {
	section: SidebarNestedNavSection;
	activeItemId: string | null;
}) {
	const { dismiss } = useAppNavigationPresentation();
	const row = input.section.row;
	if (!row) {
		return null;
	}
	// The label stays the leading text so the row keeps its label treatment;
	// the avatar renders after it in the DOM and is ordered before it.
	const leading = row.leading ? (
		<span className="order-first flex shrink-0">{row.leading}</span>
	) : null;
	return (
		<SidebarMenuSubItem data-nested-nav-section={input.section.id}>
			<SidebarMenuSubButton
				aria-disabled={row.disabled || undefined}
				aria-label={row.ariaLabel ?? row.label}
				asChild
			>
				{row.to ? (
					<Link
						onClick={(event) => {
							if (!isModifiedClick(event)) {
								dismiss();
							}
						}}
						resetScroll={false}
						to={row.to}
					>
						{row.label}
						{leading}
					</Link>
				) : (
					<button
						onClick={() => {
							if (!row.disabled) {
								row.onSelect?.();
							}
						}}
						type="button"
					>
						{row.label}
						{leading}
					</button>
				)}
			</SidebarMenuSubButton>
			{input.section.notice || input.section.items.length > 0 ? (
				<SidebarMenuSub className="ml-[17px] border-foreground/15">
					{sectionContent(input.section, input.activeItemId)}
				</SidebarMenuSub>
			) : null}
		</SidebarMenuSubItem>
	);
}

function sectionContent(
	section: SidebarNestedNavSection,
	activeItemId: string | null
): ReactNode[] {
	return [
		...(section.notice
			? [
					<li
						className="px-2 py-1 text-muted-foreground text-xs"
						key={`${section.id}:notice`}
						role="presentation"
					>
						{section.notice}
					</li>,
				]
			: []),
		...section.items.map((item) => (
			<NestedItem active={item.id === activeItemId} item={item} key={item.id} />
		)),
	];
}

function NestedItem(input: { item: SidebarNestedNavItem; active: boolean }) {
	const { dismiss } = useAppNavigationPresentation();
	const nowMs = useNowMs(60_000);
	const { item } = input;
	return (
		<SidebarMenuSubItem data-nested-nav-item={item.id}>
			<SidebarMenuSubButton
				aria-label={item.ariaLabel ?? item.label}
				asChild
				isActive={input.active}
			>
				<Link
					onClick={(event) => {
						if (!isModifiedClick(event)) {
							dismiss();
						}
					}}
					resetScroll={false}
					to={item.to}
				>
					{item.label}
					{item.timestamp == null && !item.accessory ? null : (
						// The trailing slot flows after the label, so a wide status
						// (attention dot and Wake orb) never covers the time.
						<span className="pointer-events-none ml-auto flex shrink-0 items-center gap-2 pr-0.5">
							{item.timestamp == null ? null : (
								<SidebarConversationTime
									hideOlderUntilHover
									hoverRow="sub-item"
									now={new Date(nowMs)}
									timestamp={item.timestamp}
								/>
							)}
							{item.accessory}
						</span>
					)}
				</Link>
			</SidebarMenuSubButton>
		</SidebarMenuSubItem>
	);
}

function isModifiedClick(event: {
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}) {
	return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}
