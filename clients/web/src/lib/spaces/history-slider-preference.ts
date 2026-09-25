import { useBrowserPreference } from "#/lib/use-browser-preference";

const STORAGE_KEY = "openmeld.space.history-slider";
const ATTRIBUTE = "data-space-history-slider";

export function useHistorySliderPreference() {
	const [stored, write] = useBrowserPreference(STORAGE_KEY);
	return {
		enabled: stored !== "off",
		setEnabled: (enabled: boolean) => {
			const value = enabled ? "on" : "off";
			document.documentElement.setAttribute(ATTRIBUTE, value);
			write(value);
		},
	};
}

export const HISTORY_SLIDER_BOOTSTRAP_SCRIPT = `(() => {
 const apply = () => {
  try {
   document.documentElement.setAttribute(${JSON.stringify(ATTRIBUTE)},
    localStorage.getItem(${JSON.stringify(STORAGE_KEY)}) === "off" ? "off" : "on");
  } catch { document.documentElement.setAttribute(${JSON.stringify(ATTRIBUTE)}, "on"); }
 };
 apply();
 window.addEventListener("storage", event => {
  if (event.key === ${JSON.stringify(STORAGE_KEY)} || event.key === null) apply();
 });
})();`;
