import { XIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import {
	type ToolbarShortcut as ShortcutId,
	TOOLBAR_SHORTCUTS,
	useToolbarPreference,
} from "#/lib/appearance/toolbar-preference";

export function ToolbarShortcut(input: {
	id: ShortcutId;
	children: ReactNode;
	onHide?: () => void;
}) {
	const { isVisible, setVisible } = useToolbarPreference();
	const label = TOOLBAR_SHORTCUTS.find((item) => item.id === input.id)?.label;
	return (
		<div
			className="group/shortcut pointer-events-auto relative flex min-w-0 items-center"
			data-toolbar-shortcut={input.id}
			hidden={!isVisible(input.id)}
		>
			{input.children}
			<button
				aria-label={`Hide ${label} from toolbar`}
				className="toolbar-shortcut-dismiss absolute -top-1 -right-1 z-10 flex size-5 items-center justify-center rounded-full bg-popover text-muted-foreground opacity-0 shadow-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring group-focus-within/shortcut:opacity-100 group-hover/shortcut:opacity-100"
				onClick={() => {
					input.onHide?.();
					setVisible(input.id, false);
					toast(`${label} hidden from toolbar`, {
						action: {
							label: "Undo",
							onClick: () => setVisible(input.id, true),
						},
					});
				}}
				type="button"
			>
				<XIcon className="size-3" />
			</button>
		</div>
	);
}
