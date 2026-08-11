import { describe, expect, it } from "vitest";
import { Route } from "./index";

describe("organization index route", () => {
	it("renders Home as the organization entry without redirecting", () => {
		expect(Route.options.beforeLoad).toBeUndefined();
		expect(Route.options.component).toBeTypeOf("function");
		expect(Route.options.staticData).toEqual({ appShellSection: "home" });
	});
});
