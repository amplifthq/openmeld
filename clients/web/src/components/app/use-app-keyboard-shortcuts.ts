import {
	APPLICATION_SHORTCUTS,
	blocksLetterShortcuts,
} from "@openmeld/ui/lib/application-shortcuts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationAgentsPath,
	buildOrganizationComputersPath,
	buildOrganizationDefaultPath,
	buildOrganizationDirectMessagesPath,
	buildOrganizationInboxPath,
	buildOrganizationPeoplePath,
	buildOrganizationSpacesPath,
} from "#/lib/organizations/organization-routes";

const routes = {
	home: buildOrganizationDefaultPath,
	spaces: buildOrganizationSpacesPath,
	messages: buildOrganizationDirectMessagesPath,
	people: buildOrganizationPeoplePath,
	agents: buildOrganizationAgentsPath,
	inbox: buildOrganizationInboxPath,
	computers: buildOrganizationComputersPath,
};

function isCommandShortcut(event: KeyboardEvent) {
	return (
		(event.metaKey || event.ctrlKey) &&
		!event.altKey &&
		!event.shiftKey &&
		event.key.toLowerCase() === APPLICATION_SHORTCUTS.commandCenter
	);
}

export function useAppKeyboardShortcuts(toggleCommandCenter: () => void) {
	const { currentOrganization } = useAppOrganization();
	const navigate = useNavigate();
	useEffect(() => {
		let prefixAt = 0;
		const clear = () => {
			prefixAt = 0;
		};
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Keep the ordered keyboard guards and one-shot prefix lifecycle together.
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.isComposing || event.repeat) {
				clear();
				return;
			}
			const key = event.key.toLowerCase();
			if (isCommandShortcut(event)) {
				clear();
				event.preventDefault();
				toggleCommandCenter();
				return;
			}
			if (blocksLetterShortcuts(event)) {
				clear();
				return;
			}
			if (event.shiftKey) {
				clear();
				return;
			}
			if (prefixAt && Date.now() - prefixAt <= 1000) {
				clear();
				const destination =
					APPLICATION_SHORTCUTS.destinations[
						key as keyof typeof APPLICATION_SHORTCUTS.destinations
					];
				if (destination) {
					event.preventDefault();
					navigate({ to: routes[destination](currentOrganization.slug) }).catch(
						(error: unknown) =>
							console.error("Shortcut navigation failed", error)
					);
					return;
				}
			}
			prefixAt =
				key === APPLICATION_SHORTCUTS.navigationPrefix ? Date.now() : 0;
		};
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("blur", clear);
		window.addEventListener("focusin", clear);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("blur", clear);
			window.removeEventListener("focusin", clear);
		};
	}, [currentOrganization.slug, navigate, toggleCommandCenter]);
}
