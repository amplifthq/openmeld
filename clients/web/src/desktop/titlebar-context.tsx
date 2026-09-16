import { createContext, useContext } from "react";
import type { createDesktopNavigation } from "./navigation";

export const DesktopTitlebarContext = createContext<{
	target: HTMLDivElement | null;
	navigation: ReturnType<typeof createDesktopNavigation>;
} | null>(null);

export const useDesktopTitlebar = () => useContext(DesktopTitlebarContext);
