import type { BotAvatarMaterial } from "@openmeld/ui/components/bot-avatar";
import { useBrowserPreference } from "#/lib/use-browser-preference";

export const BOT_MATERIAL_CHOICES = [
	{ value: "fabric", label: "Fabric", description: "Soft, textured finish." },
	{ value: "plastic", label: "Plastic", description: "Smooth, glossy finish." },
] as const;

export function useBotAvatarPreference() {
	const [stored, write] = useBrowserPreference(
		"openmeld.appearance.bot-animation"
	);
	const [material, writeMaterial] = useBrowserPreference(
		"openmeld.appearance.bot-material"
	);
	const shading: BotAvatarMaterial =
		material === "plastic" ? "plastic" : "fabric";
	return {
		motionEnabled: stored !== "off",
		setMotionEnabled: (enabled: boolean) => write(enabled ? "on" : "off"),
		shading,
		setShading: (next: BotAvatarMaterial) => writeMaterial(next),
	};
}
