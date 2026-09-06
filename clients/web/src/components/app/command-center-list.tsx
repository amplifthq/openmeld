"use client";

import { FluidHoverHighlight } from "@openmeld/ui/fluid/hover-highlight";
import { Command } from "cmdk";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

const WORD_BREAK = /\s+/;

export type CommandEntry = {
	id: string;
	label: string;
	accessibleLabel?: string;
	group: string;
	keywords?: string;
	leading?: ReactNode;
	trailing?: ReactNode;
	description?: string;
	actionLabel?: string;
	run: () => void;
};

export function CommandCenterList(input: {
	entries: readonly CommandEntry[];
	query: string;
	onQueryChange: (value: string) => void;
	loading?: boolean;
	error?: boolean;
}) {
	const [value, setValue] = useState("");
	const [rect, setRect] = useState<{
		top: number;
		left: number;
		width: number;
		height: number;
	} | null>(null);
	const list = useRef<HTMLDivElement>(null);
	const pointer = useRef(false);
	const query = input.query.trim().toLocaleLowerCase();
	const entries = input.entries
		.filter(
			(item) =>
				!query ||
				query
					.split(WORD_BREAK)
					.every((word) =>
						`${item.label} ${item.keywords ?? ""}`
							.toLocaleLowerCase()
							.includes(word)
					)
		)
		.sort(
			(a, b) =>
				Number(b.label.toLocaleLowerCase() === query) -
				Number(a.label.toLocaleLowerCase() === query)
		);
	const groups = [...new Set(entries.map((item) => item.group))];
	const selected = entries.find((item) => item.id === value);

	useLayoutEffect(() => {
		const container = list.current;
		if (!container) {
			return;
		}
		const measure = () => {
			const element = container.querySelector<HTMLElement>(
				'[cmdk-item][data-selected="true"]'
			);
			if (!element) {
				setRect(null);
				return;
			}
			const parent = container.getBoundingClientRect();
			const item = element.getBoundingClientRect();
			const next = {
				top: item.top - parent.top + container.scrollTop,
				left: item.left - parent.left,
				width: item.width,
				height: item.height,
			};
			setRect((previous) =>
				previous &&
				previous.top === next.top &&
				previous.left === next.left &&
				previous.width === next.width &&
				previous.height === next.height
					? previous
					: next
			);
		};
		// cmdk owns selection and commits its public selected attribute after its
		// external-store update. Observe that commit, not a competing selection state.
		const observer = new MutationObserver(measure);
		observer.observe(container, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ["data-selected"],
		});
		const resize = new ResizeObserver(measure);
		resize.observe(container);
		measure();
		return () => {
			observer.disconnect();
			resize.disconnect();
		};
	}, []);

	return (
		<Command
			className="flex min-h-0 flex-col text-popover-foreground"
			label="Search or run a command"
			onKeyDownCapture={() => {
				pointer.current = false;
			}}
			onPointerMoveCapture={() => {
				pointer.current = true;
			}}
			onValueChange={setValue}
			shouldFilter={false}
			value={value}
		>
			<div className="p-3 pb-2">
				<Command.Input
					aria-label="Search or run a command"
					autoFocus
					className="h-11 w-full rounded-lg border border-input bg-muted/50 px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
					onValueChange={(text) => {
						pointer.current = false;
						input.onQueryChange(text);
					}}
					placeholder="Search or run a command…"
					value={input.query}
				/>
			</div>
			<Command.List
				aria-busy={input.loading}
				className="relative max-h-[min(55dvh,440px)] min-h-24 overflow-y-auto px-2 pb-2"
				ref={list}
			>
				{rect && (
					<FluidHoverHighlight
						className="rounded-lg"
						instant={!pointer.current}
						rect={rect}
						slot="command-highlight"
					/>
				)}
				{input.error && (
					<output className="block px-3 py-2 text-muted-foreground text-sm">
						Search could not load. Close and reopen to retry.
					</output>
				)}
				{input.loading && (
					<output className="block px-3 py-2 text-muted-foreground text-sm">
						Loading…
					</output>
				)}
				{groups.map((group) => (
					<Command.Group
						className="relative [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:text-xs"
						heading={group}
						key={group}
					>
						{entries
							.filter((entry) => entry.group === group)
							.map((entry) => (
								<Command.Item
									aria-label={entry.accessibleLabel ?? entry.label}
									className="relative flex min-h-10 cursor-default items-center gap-3 rounded-lg px-3 py-2 text-sm outline-none data-[selected=true]:text-foreground"
									key={entry.id}
									onMouseEnter={() => {
										pointer.current = true;
										setValue(entry.id);
									}}
									onSelect={entry.run}
									value={entry.id}
								>
									{entry.leading && (
										<span className="flex size-5 shrink-0 items-center justify-center">
											{entry.leading}
										</span>
									)}
									<span className="min-w-0 flex-1">
										<span className="block truncate">{entry.label}</span>
										{entry.description && (
											<span className="block truncate text-muted-foreground text-xs">
												{entry.description}
											</span>
										)}
									</span>
									{entry.trailing}
								</Command.Item>
							))}
					</Command.Group>
				))}
				{!(entries.length || input.loading) && (
					<Command.Empty className="px-3 py-6 text-muted-foreground text-sm">
						No results. Try another search.
					</Command.Empty>
				)}
			</Command.List>
			<div className="flex items-center gap-2 border-t bg-muted/40 px-4 py-3 text-muted-foreground text-xs">
				<kbd className="rounded bg-background px-1.5 py-0.5">↵</kbd>
				<span>{selected?.actionLabel ?? "Open"}</span>
				<span className="ml-auto">↑ ↓ Navigate</span>
				<span>Esc Close</span>
			</div>
		</Command>
	);
}
