import { act, cleanup, render, screen } from "@testing-library/react";
import type { ImageGenerationProps } from "img-fx";
import { afterEach, expect, it, vi } from "vitest";
import SpaceImageLoadingEffect from "./space-image-loading-effect";

const renderer = vi.hoisted(() => ({ props: [] as ImageGenerationProps[] }));
vi.mock("img-fx", () => ({
	ImageGeneration: (props: ImageGenerationProps) => {
		renderer.props.push(props);
		return <div data-testid="real-component-boundary">{props.children}</div>;
	},
}));
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

it("uses ImageGeneration without private sources or reveal cycles, and releases every renderer on context loss", () => {
	vi.stubGlobal("WebGL2RenderingContext", undefined);
	const unsupported = render(<SpaceImageLoadingEffect />);
	expect(renderer.props).toHaveLength(0);
	unsupported.unmount();
	vi.stubGlobal("WebGL2RenderingContext", class {});
	const view = render(
		<>
			<SpaceImageLoadingEffect />
			<SpaceImageLoadingEffect />
		</>
	);
	expect(screen.getAllByTestId("real-component-boundary")).toHaveLength(2);
	for (const props of renderer.props) {
		expect(props.images).toEqual([]);
		expect(props.autoReveal).toBe(false);
		expect(props.preset).toBe("pixels-organic");
		expect(props.paused).toBe(false);
	}
	act(() => window.dispatchEvent(new Event("img-fx:context-lost")));
	expect(screen.queryByTestId("real-component-boundary")).toBeNull();
	view.unmount();
	render(<SpaceImageLoadingEffect />);
	expect(screen.queryByTestId("real-component-boundary")).toBeNull();
});
