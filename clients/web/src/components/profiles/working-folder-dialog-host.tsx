"use client";

import type { AuthProfileView } from "@openmeld/schemas/types";
import { useEffect, useSyncExternalStore } from "react";

/** What the Working folder dialog needs, captured from the action that opened it. */
export type WorkingFolderDialogRequest = {
	actorProfileId: string | null;
	folderMissing?: boolean;
	fromReadiness?: boolean;
	onProfileUpdated: (profile: AuthProfileView) => void;
	organizationId: string;
	profile: AuthProfileView;
	storageScope: string;
};

type HostedDialog = {
	id: number;
	open: boolean;
	request: WorkingFolderDialogRequest;
};

/**
 * The open Working folder dialog lives here, above every surface that offers
 * it. Those surfaces come and go with the Agent's readiness ("Checking",
 * "Working folder missing"); the dialog must not go with them.
 */
let hosted: HostedDialog | null = null;
let nextId = 1;
let mountedHosts = 0;
const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) {
		listener();
	}
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Whether an app-level host is mounted to take the dialog. */
export function hasWorkingFolderDialogHost(): boolean {
	return mountedHosts > 0;
}

export function openWorkingFolderDialog(request: WorkingFolderDialogRequest) {
	hosted = { id: nextId, open: true, request };
	nextId += 1;
	emit();
}

/** Keeps the open dialog's Agent current while the action that opened it is shown. */
export function syncWorkingFolderDialogRequest(
	request: WorkingFolderDialogRequest
) {
	if (
		hosted?.open &&
		hosted.request.profile.openMeldProfileId ===
			request.profile.openMeldProfileId &&
		(hosted.request.profile !== request.profile ||
			hosted.request.folderMissing !== request.folderMissing ||
			hosted.request.fromReadiness !== request.fromReadiness)
	) {
		hosted = { ...hosted, request };
		emit();
	}
}

function closeHostedDialog(id: number) {
	if (hosted?.id === id && hosted.open) {
		hosted = { ...hosted, open: false };
		emit();
	}
}

function releaseHostedDialog(id: number) {
	if (hosted?.id === id && !hosted.open) {
		hosted = null;
		emit();
	}
}

function updateHostedProfile(id: number, profile: AuthProfileView) {
	if (hosted?.id === id) {
		hosted = { ...hosted, request: { ...hosted.request, profile } };
		emit();
	}
}

export type WorkingFolderDialogView = (input: {
	onOpenChange: (open: boolean) => void;
	onOpenChangeComplete: (open: boolean) => void;
	open: boolean;
	request: WorkingFolderDialogRequest;
}) => React.ReactNode;

/**
 * Mount once inside the app shell. Renders the dialog opened by any Working
 * folder action until its close animation ends.
 */
export function WorkingFolderDialogHost(input: {
	dialog: WorkingFolderDialogView;
}) {
	useEffect(() => {
		mountedHosts += 1;
		return () => {
			mountedHosts -= 1;
		};
	}, []);
	const current = useSyncExternalStore(
		subscribe,
		() => hosted,
		() => null
	);
	if (!current) {
		return null;
	}
	const Dialog = input.dialog;
	return (
		<Dialog
			key={current.id}
			onOpenChange={(open) => {
				if (!open) {
					closeHostedDialog(current.id);
				}
			}}
			onOpenChangeComplete={(open) => {
				if (!open) {
					releaseHostedDialog(current.id);
				}
			}}
			open={current.open}
			request={{
				...current.request,
				onProfileUpdated: (profile) => {
					updateHostedProfile(current.id, profile);
					current.request.onProfileUpdated(profile);
				},
			}}
		/>
	);
}

/** Test support: forget any hosted dialog. */
export function resetWorkingFolderDialogHostForTests() {
	hosted = null;
	emit();
}
