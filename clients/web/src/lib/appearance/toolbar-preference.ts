import { useBrowserPreference } from "../use-browser-preference";

const STORAGE_KEY = "openmeld.toolbar.hidden";
const ATTRIBUTE = "data-hidden-toolbar-shortcuts";
export const TOOLBAR_SHORTCUTS = [
	{ id: "computer", label: "Computer" },
	{ id: "center_agent", label: "Center Agent" },
	{ id: "inbox", label: "Inbox" },
] as const;
export type ToolbarShortcut = (typeof TOOLBAR_SHORTCUTS)[number]["id"];

export function useToolbarPreference() {
	const [stored, write] = useBrowserPreference(STORAGE_KEY);
	const hidden = (stored ?? "").split(" ");
	return {
		isVisible: (id: ToolbarShortcut) => !hidden.includes(id),
		setVisible: (id: ToolbarShortcut, visible: boolean) => {
			const next = TOOLBAR_SHORTCUTS.filter((item) =>
				item.id === id ? !visible : hidden.includes(item.id)
			)
				.map((item) => item.id)
				.join(" ");
			document.documentElement.setAttribute(ATTRIBUTE, next);
			write(next);
		},
	};
}

// Match the existing Appearance bootstrap so a hidden toolbar never flashes on reload.
export const TOOLBAR_PREFERENCE_BOOTSTRAP_SCRIPT = `(() => {
 const apply = () => {
 try {
  const hidden = (localStorage.getItem(${JSON.stringify(STORAGE_KEY)}) || "").split(" ");
  document.documentElement.setAttribute(${JSON.stringify(ATTRIBUTE)}, ${JSON.stringify(TOOLBAR_SHORTCUTS.map((item) => item.id))}.filter(id => hidden.includes(id)).join(" "));
 } catch (error) { console.warn("Unable to restore toolbar preferences.", error); }
 };
 apply();
 window.addEventListener("storage", event => {
  if (event.key === ${JSON.stringify(STORAGE_KEY)} || event.key === null) apply();
 });
})();`;
