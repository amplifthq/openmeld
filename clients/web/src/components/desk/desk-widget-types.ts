export type DeskWidgetKind =
	| "inbox"
	| "activity"
	| "people"
	| "computer"
	| "center"
	| "chat"
	| "text";
export type DeskWidget = {
	id: string;
	kind: DeskWidgetKind;
	title: string;
	spaceId?: string;
	profileId?: string;
	targetProfileId?: string;
};
export const deskWidgetLabels: Record<DeskWidgetKind, string> = {
	inbox: "Inbox",
	activity: "Active agents",
	people: "People & Agents",
	computer: "Computers",
	center: "Center Agent",
	chat: "Chat",
	text: "Text",
};
