import { useSyncExternalStore } from "react";
import type { ComposerDraftAuthoredMention } from "#/lib/composer-draft-storage";

const eventName = "openmeld-welcome-space";
export type WelcomeSpaceStep = "prepare" | "add" | "send" | "done";
function key(scope: string, spaceId: string) {
	return `openmeld.welcome-space:${scope}:${spaceId}`;
}
function readProgress(scope: string, spaceId: string) {
	let value = localStorage.getItem(key(scope, spaceId)) ?? "";
	while (value.startsWith("paused:")) {
		value = value.split(":").slice(2).join(":");
	}
	return value;
}
export function readWelcomeSpace(
	scope: string,
	spaceId: string
): WelcomeSpaceStep | null {
	if (typeof window === "undefined") {
		return null;
	}
	const value = readProgress(scope, spaceId).split(":")[0];
	return value === "prepare" ||
		value === "add" ||
		value === "send" ||
		value === "done"
		? value
		: null;
}
export function saveWelcomeSpace(
	scope: string,
	spaceId: string,
	step: WelcomeSpaceStep
) {
	localStorage.setItem(key(scope, spaceId), `${step}:${Date.now()}`);
	window.dispatchEvent(new Event(eventName));
}
export function welcomeStepStartedAt(scope: string, spaceId: string) {
	return Number(readProgress(scope, spaceId).split(":")[1] ?? 0);
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

type WelcomeMember = {
	profileId: string;
	profileName: string;
	profileKind: "human" | "agent";
};

/** Draft recipient selection only; membership always comes from the Space snapshot. */
export function saveWelcomeRecipients(
	scope: string,
	spaceId: string,
	ids: string[]
) {
	localStorage.setItem(
		`${key(scope, spaceId)}:recipients`,
		JSON.stringify(ids)
	);
}

export function readWelcomeRecipients(
	scope: string,
	spaceId: string
): string[] {
	try {
		const value: unknown = JSON.parse(
			localStorage.getItem(`${key(scope, spaceId)}:recipients`) ?? "[]"
		);
		return Array.isArray(value) && value.every((id) => typeof id === "string")
			? value
			: [];
	} catch {
		return [];
	}
}

export function resolveWelcomeRecipients<T extends WelcomeMember>(
	members: readonly T[],
	recipientIds: readonly string[],
	selfId: string
): T[] {
	if (recipientIds.length > 0) {
		return recipientIds.flatMap((id) => {
			const member = members.find((candidate) => candidate.profileId === id);
			return member ? [member] : [];
		});
	}
	return members.filter(
		(member) => member.profileKind === "agent" && member.profileId !== selfId
	);
}

export function buildWelcomeSpaceDraft(members: readonly WelcomeMember[]) {
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
	text += "Hi! Please briefly introduce yourself and how you can help here.";
	return {
		text,
		authoredMentions,
		selection: { start: text.length, end: text.length },
	};
}
