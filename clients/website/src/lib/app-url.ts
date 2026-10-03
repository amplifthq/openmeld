const appOrigin = import.meta.env.VITE_APP_URL || "https://app.openmeld.ai";

export function appUrl(path: string) {
	return new URL(path, appOrigin).href;
}
