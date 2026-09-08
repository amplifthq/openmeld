import type { ComponentProps } from "react";
import { useSortableSidebarItem } from "../app/sidebar-drag";
import { SpaceSidebarMenuItem } from "./space-sidebar-menu-item";

export function SortableSpaceSidebarItem(
	input: ComponentProps<typeof SpaceSidebarMenuItem> & {
		section: string;
		dragDisabled: boolean;
	}
) {
	const { section, dragDisabled, ...item } = input;
	const drag = useSortableSidebarItem({
		section,
		disabled: dragDisabled,
		itemId: item.item.spaceId,
		name: item.item.spaceName,
	});
	return <SpaceSidebarMenuItem {...item} drag={drag} />;
}
