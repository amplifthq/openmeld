import { createContext, useContext } from "react";

// Embedded product surfaces can navigate internally without having public URLs.
export const AppLinkCapability = createContext(true);
export function useAppLinkCapability() {
	return useContext(AppLinkCapability);
}
