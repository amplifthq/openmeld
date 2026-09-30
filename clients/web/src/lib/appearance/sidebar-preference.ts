import { useBrowserPreference } from "../use-browser-preference";

const STORAGE_KEY = "openmeld.appearance.sidebar-display";
const ATTRIBUTE = "data-sidebar-display";
export type SidebarDisplay = "icons-and-text" | "icons-only";
export const SIDEBAR_DISPLAY_CHOICES = [
	{
		value: "icons-and-text",
		label: "Icons and text",
		description: "Show navigation icons with their names.",
	},
	{
		value: "icons-only",
		label: "Icons only",
		description: "Show compact icons. Hover over an icon to see its name.",
	},
] as const;

export function useSidebarDisplayPreference() {
	const [stored, write] = useBrowserPreference(STORAGE_KEY);
	const display: SidebarDisplay =
		stored === "icons-only" ? "icons-only" : "icons-and-text";
	return {
		display,
		setDisplay: (next: SidebarDisplay) => {
			document.documentElement.setAttribute(ATTRIBUTE, next);
			write(next);
		},
	};
}

// Restore the CSS projection before paint; React and both controls read the same key.
export const SIDEBAR_PREFERENCE_BOOTSTRAP_SCRIPT = `(() => {
 const apply = () => {
  let display = "icons-and-text";
  try {
   if (localStorage.getItem(${JSON.stringify(STORAGE_KEY)}) === "icons-only") display = "icons-only";
  } catch (error) { console.warn("Unable to restore sidebar preferences.", error); }
  document.documentElement.setAttribute(${JSON.stringify(ATTRIBUTE)}, display);
 };
 apply();
 window.addEventListener("storage", event => {
  if (event.key === ${JSON.stringify(STORAGE_KEY)} || event.key === null) apply();
 });
})();`;
