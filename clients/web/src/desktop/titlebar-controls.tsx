import { Kbd } from "@openmeld/ui/components/kbd";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { useSidebar } from "@openmeld/ui/fluid/sidebar-state";
import { useMediaQuery } from "@openmeld/ui/hooks/use-media-query";
import { APPLICATION_SHORTCUTS } from "@openmeld/ui/lib/application-shortcuts";
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	SidebarSimpleIcon,
} from "@phosphor-icons/react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { useDesktopTitlebar } from "./titlebar-context";

export function DesktopTitlebarControls(input: {
	available: boolean;
	drawerOpen: boolean;
	toggleDrawer: () => void;
}) {
	const frame = useDesktopTitlebar();
	return frame ? <Controls {...input} frame={frame} /> : null;
}

function Controls({
	frame,
	...input
}: Parameters<typeof DesktopTitlebarControls>[0] & {
	frame: NonNullable<ReturnType<typeof useDesktopTitlebar>>;
}) {
	const { state, toggleSidebar } = useSidebar();
	const wide = useMediaQuery("(min-width: 64rem)");
	const account = useOptionalAppOrganization()?.currentUserId ?? null;
	const { navigation, target } = frame;
	const history = useSyncExternalStore(
		navigation.subscribe,
		navigation.getSnapshot,
		navigation.getSnapshot
	);
	useEffect(() => {
		navigation.identify(account);
	}, [navigation, account]);
	const toggle = useCallback(() => {
		if (!input.available) {
			return;
		}
		if (wide) {
			toggleSidebar();
		} else {
			input.toggleDrawer();
		}
	}, [input.available, input.toggleDrawer, toggleSidebar, wide]);
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				event.repeat ||
				event.isComposing ||
				!event.metaKey ||
				event.ctrlKey ||
				event.altKey ||
				event.shiftKey
			) {
				return;
			}
			if (hasLocalKeyboardOwner(event)) {
				return;
			}
			const key = event.key.toLowerCase();
			const actions: Record<string, () => void> = {
				[APPLICATION_SHORTCUTS.sidebar]: toggle,
				[APPLICATION_SHORTCUTS.desktopBack]: navigation.back,
				[APPLICATION_SHORTCUTS.desktopForward]: navigation.forward,
			};
			const action = actions[key];
			if (!action) {
				return;
			}
			event.preventDefault();
			action();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [navigation, toggle]);
	if (!target) {
		return null;
	}
	return createPortal(
		<nav aria-label="Window navigation" className="desktop-titlebar-controls">
			<Control
				disabled={!input.available}
				expanded={wide ? state === "expanded" : input.drawerOpen}
				label="Toggle sidebar"
				onClick={toggle}
				shortcut={`⌘${APPLICATION_SHORTCUTS.sidebar.toUpperCase()}`}
			>
				<SidebarSimpleIcon />
			</Control>
			<Control
				disabled={!history.back}
				label="Back"
				onClick={navigation.back}
				shortcut={`⌘${APPLICATION_SHORTCUTS.desktopBack}`}
			>
				<ArrowLeftIcon />
			</Control>
			<Control
				disabled={!history.forward}
				label="Forward"
				onClick={navigation.forward}
				shortcut={`⌘${APPLICATION_SHORTCUTS.desktopForward}`}
			>
				<ArrowRightIcon />
			</Control>
		</nav>,
		target
	);
}

function hasLocalKeyboardOwner(event: KeyboardEvent) {
	return (
		(event.target instanceof HTMLElement &&
			event.target.closest(
				"input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox],[role=dialog],[role=menu]"
			)) ||
		document.querySelector('[role="dialog"][aria-modal="true"]')
	);
}

function Control(input: {
	label: string;
	shortcut: string;
	disabled: boolean;
	expanded?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<button
						aria-expanded={input.expanded}
						aria-label={input.label}
						className="desktop-titlebar-button"
						disabled={input.disabled}
						onClick={input.onClick}
						type="button"
					/>
				}
			>
				{input.children}
			</TooltipTrigger>
			<TooltipContent side="bottom">
				{input.label} <Kbd>{input.shortcut}</Kbd>
			</TooltipContent>
		</Tooltip>
	);
}
