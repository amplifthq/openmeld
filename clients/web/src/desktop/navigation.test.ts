import { createMemoryHistory } from "@tanstack/react-router";
import { expect, it } from "vitest";
import { createDesktopNavigation } from "./navigation";

it("bounds navigation to the admitted account, truncates Forward on push, and keeps replacement URLs", () => {
	const history = createMemoryHistory({
		initialEntries: ["/login", "/o/team/spaces"],
	});
	const navigation = createDesktopNavigation(history);
	const disconnect = navigation.connect();
	navigation.identify("account-a");
	navigation.back();
	expect(history.location.href).toBe("/o/team/spaces");
	history.push("/o/team/people");
	expect(navigation.getSnapshot()).toEqual({ back: true, forward: false });
	navigation.back();
	expect(navigation.getSnapshot()).toEqual({ back: false, forward: true });
	navigation.forward();
	history.replace("/o/team/people?person=a#details");
	navigation.back();
	navigation.forward();
	expect(history.location.href).toBe("/o/team/people?person=a#details");
	navigation.back();
	history.push("/o/team/inbox");
	expect(navigation.getSnapshot()).toEqual({ back: true, forward: false });
	navigation.back();
	navigation.reset(); // Native session invalidation closes both old directions immediately.
	expect(navigation.getSnapshot()).toEqual({ back: false, forward: false });
	navigation.identify("account-b");
	navigation.forward();
	expect(history.location.href).toBe("/o/team/spaces");
	history.push("/o/other/people");
	navigation.back();
	expect(history.location.href).toBe("/o/team/spaces");
	history.replace("/desktop-shell");
	expect(navigation.getSnapshot()).toEqual({ back: false, forward: false });
	disconnect();
});
