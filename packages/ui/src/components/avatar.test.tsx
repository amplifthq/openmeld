import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  Avatar,
  AvatarAction,
  AvatarBadge,
  AvatarFallback,
} from "#components/avatar";

afterEach(() => {
  cleanup();
});

describe("Avatar", () => {
  it("lets a status badge sit outside the circular avatar edge", () => {
    const { container } = render(
      <Avatar>
        <AvatarFallback>FL</AvatarFallback>
        <AvatarBadge aria-label="Working" />
      </Avatar>
    );

    const avatar = container.querySelector('[data-slot="avatar"]');
    const badge = container.querySelector('[data-slot="avatar-badge"]');

    expect(avatar?.classList.contains("overflow-hidden")).toBe(false);
    expect(badge?.classList.contains("absolute")).toBe(true);
    expect(badge?.classList.contains("right-0")).toBe(true);
    expect(badge?.classList.contains("bottom-0")).toBe(true);
  });

  it("keeps a small corner action on a full-size touch target", () => {
    const { container } = render(
      <Avatar>
        <AvatarFallback>FL</AvatarFallback>
        <AvatarAction aria-label="Remove photo">×</AvatarAction>
      </Avatar>
    );

    const action = container.querySelector('[data-slot="avatar-action"]');

    expect(action?.classList.contains("size-11")).toBe(true);
    expect(action?.classList.contains("-top-3")).toBe(true);
    expect(action?.classList.contains("-right-3")).toBe(true);
  });
});
