import importImageEffect from "virtual:openmeld-image-loading-effect";

type ImageEffectModule = typeof import("./space-image-loading-effect");
const staticEffect: ImageEffectModule = { default: () => null };

export async function loadSpaceImageEffect(): Promise<ImageEffectModule> {
	if (importImageEffect === null) {
		return staticEffect;
	}
	try {
		// The build emits this chunk explicitly. Keep the native import so only
		// this optional module bypasses Vite's global critical-asset recovery.
		return (await importImageEffect()) as ImageEffectModule;
	} catch {
		// Never report an image failure or log a private URL for decoration loss.
		console.warn(
			"Image loading effect unavailable; using the static placeholder."
		);
		return staticEffect;
	}
}
