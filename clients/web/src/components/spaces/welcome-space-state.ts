import { useSyncExternalStore } from "react";
import type { ComposerDraftAuthoredMention } from "#/lib/composer-draft-storage";

const eventName = "openmeld-welcome-space";
export type WelcomeSpaceStep = "prepare" | "add" | "send" | "done" | "paused";
function key(scope: string, spaceId: string) {
	return `openmeld.welcome-space:${scope}:${spaceId}`;
}
export function readWelcomeSpace(
	scope: string,
	spaceId: string
): WelcomeSpaceStep | null {
	if (typeof window === "undefined") {
		return null;
	}
	const value = localStorage.getItem(key(scope, spaceId))?.split(":")[0];
	return value === "prepare" ||
		value === "add" ||
		value === "send" ||
		value === "done" ||
		value === "paused"
		? value
		: null;
}
export function saveWelcomeSpace(
	scope: string,
	spaceId: string,
	step: WelcomeSpaceStep
) {
	const previous = localStorage.getItem(key(scope, spaceId));
	localStorage.setItem(
		key(scope, spaceId),
		step === "paused"
			? `paused:${Date.now()}:${previous ?? "add:0"}`
			: `${step}:${Date.now()}`
	);
	window.dispatchEvent(new Event(eventName));
}
export function resumeWelcomeSpace(scope: string, spaceId: string) {
	const previous = localStorage.getItem(key(scope, spaceId));
	if (previous?.startsWith("paused:")) {
		localStorage.setItem(
			key(scope, spaceId),
			previous.split(":").slice(2).join(":")
		);
		window.dispatchEvent(new Event(eventName));
	}
}
export function welcomeStepStartedAt(scope: string, spaceId: string) {
	return Number(localStorage.getItem(key(scope, spaceId))?.split(":")[1] ?? 0);
}
function subscribe(callback: () => void) {
	window.addEventListener(eventName, callback);
	window.addEventListener("storage", callback);
	return () => {
		window.removeEventListener(eventName, callback);
		window.removeEventListener("storage", callback);
	};
}
export function useWelcomeSpace(scope: string, spaceId: string) {
	return useSyncExternalStore(
		subscribe,
		() => readWelcomeSpace(scope, spaceId),
		() => null
	);
}

export function buildWelcomeSpaceDraft(
	members: readonly {
		profileId: string;
		profileName: string;
		profileKind: "human" | "agent";
	}[]
) {
	let text = "";
	const authoredMentions: ComposerDraftAuthoredMention[] = [];
	for (const member of members) {
		const label = `@${member.profileName}`;
		authoredMentions.push({
			start: text.length,
			end: text.length + label.length,
			text: label,
			profileId: member.profileId,
			relation: member.profileKind === "agent" ? "wake" : "mention",
		});
		text += `${label} `;
	}
	text +=
		"Help me plan a simple personal website. Suggest three first steps. Don’t change any files yet.";
	return {
		text,
		authoredMentions,
		selection: { start: text.length, end: text.length },
	};
}
