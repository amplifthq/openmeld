import { EmojiPicker } from "frimousse";
import type * as React from "react";
export default function SpaceEmojiPicker({
	onSelect,
}: {
	onSelect: (emoji: { emoji: string; label: string }) => void;
}) {
	return (
		<EmojiPicker.Root
			className="flex w-full flex-col"
			columns={8}
			emojibaseUrl="/emoji/17.0.0"
			onEmojiSelect={onSelect}
		>
			<div className="flex items-center gap-1 p-2">
				<EmojiPicker.Search
					aria-label="Search emoji"
					className="h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
					placeholder="Search emoji…"
				/>
				<EmojiPicker.SkinToneSelector className="size-8 rounded-md text-xl hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" />
			</div>
			<EmojiPicker.Viewport className="h-64">
				<EmojiPicker.Loading className="block p-4 text-muted-foreground text-xs">
					Loading emoji…
				</EmojiPicker.Loading>
				<EmojiPicker.Empty className="block p-4 text-muted-foreground text-xs">
					No emoji found.
				</EmojiPicker.Empty>
				<EmojiPicker.List components={pickerComponents} />
			</EmojiPicker.Viewport>
		</EmojiPicker.Root>
	);
}

const pickerComponents: NonNullable<
	React.ComponentProps<typeof EmojiPicker.List>["components"]
> = {
	CategoryHeader: ({ category, ...props }) => (
		<div
			{...props}
			className="bg-surface-3 px-2 py-1.5 font-medium text-muted-foreground text-xs"
		>
			{category.label}
		</div>
	),
	Row: (props) => <div {...props} className="px-1" />,
	Emoji: ({ emoji, ...props }) => (
		<button
			{...props}
			className="size-8 flex-none rounded-md text-xl data-active:bg-muted"
			type="button"
		>
			{emoji.emoji}
		</button>
	),
};
