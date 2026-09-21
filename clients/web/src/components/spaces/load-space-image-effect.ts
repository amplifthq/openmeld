import imageEffectUrl from "virtual:openmeld-image-loading-effect-url";

type ImageEffectModule = typeof import("./space-image-loading-effect");
const staticEffect: ImageEffectModule = { default: () => null };

export async function loadSpaceImageEffect(): Promise<ImageEffectModule> {
	try {
		// The build emits this chunk explicitly. Keep the native import so only
		// this optional module bypasses Vite's global critical-asset recovery.
		return (await import(
			/* @vite-ignore */ imageEffectUrl
		)) as ImageEffectModule;
	} catch {
		// Never report an image failure or log a private URL for decoration loss.
		console.warn(
			"Image loading effect unavailable; using the static placeholder."
		);
		return staticEffect;
	}
}
