import { describe, expect, it, vi } from "vitest";
import type { Presenter } from "../src/runtime/presenter";
import { emitSpaceLinkOutput } from "../src/space/link-command";

const TARGET = {
  spaceId: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  signalId: "11111111-1111-4111-8111-111111111111",
  threadRootSignalId: "22222222-2222-4222-8222-222222222222",
};
const URL = `https://openmeld.ai/spaces/${TARGET.spaceId}?signalId=${TARGET.signalId}&threadRootSignalId=${TARGET.threadRootSignalId}`;

describe("Space link output", () => {
  it("gives Agent View the target, link, and access continuation", () => {
    const presenter = createPresenter("agent");

    emitSpaceLinkOutput({ presenter, target: TARGET, url: URL });

    expect(presenter.data).toHaveBeenCalledWith({
      code: "space.link",
      payload: {
        accessCommand: `openmeld space access ${JSON.stringify(URL)} --view agent`,
        grantsAccess: false,
        target: TARGET,
        url: URL,
      },
    });
    expect(presenter.line).not.toHaveBeenCalled();
  });

  it("keeps Human View concise and explicit about access", () => {
    const presenter = createPresenter("human");

    emitSpaceLinkOutput({ presenter, target: TARGET, url: URL });

    expect(presenter.line).toHaveBeenNthCalledWith(1, {
      code: "space.link",
      text: `Space link: ${URL}`,
    });
    expect(presenter.line).toHaveBeenNthCalledWith(2, {
      code: "space.link.access_note",
      text: "Access is still checked when someone opens it.",
    });
    expect(presenter.data).not.toHaveBeenCalled();
  });
});

function createPresenter(view: "agent" | "human"): Presenter {
  return {
    view,
    event: vi.fn(),
    line: vi.fn(),
    data: vi.fn(),
  };
}
