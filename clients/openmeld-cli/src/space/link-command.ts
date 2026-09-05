import { spaceEntryTargetSchema } from "@openmeld/schemas";
import type { SpaceEntryTarget } from "@openmeld/schemas/types";
import { buildPublicSpaceEntryUrl } from "@openmeld/space";
import { resolveBaseUrl } from "../config/base-url";
import { formatOpenMeldCliCommand } from "../runtime/cli-entry-command";
import { resolveRuntimeContext } from "../runtime/context";
import { createPresenter } from "../runtime/presenter/index";
import type { Presenter } from "../runtime/presenter/types";
import {
  assertFullSignalIdArgument,
  assertValidSpaceIdTarget,
} from "./command-context";
import { resolveGatewayWebOrigin } from "./web-url";

export async function runSpaceLink(input: {
  baseUrl?: string;
  signalId?: string;
  space: string;
  threadRootSignalId?: string;
  view?: string;
}): Promise<void> {
  const runtime = await resolveRuntimeContext({ view: input.view });
  const presenter = createPresenter(runtime);
  assertValidSpaceIdTarget({
    space: input.space,
    resolvedView: runtime.resolvedView,
  });
  assertFullSignalIdArgument({
    value: input.signalId,
    flag: "--signal",
    resolvedView: runtime.resolvedView,
  });
  assertFullSignalIdArgument({
    value: input.threadRootSignalId,
    flag: "--thread-root-signal",
    resolvedView: runtime.resolvedView,
  });

  const target = spaceEntryTargetSchema.parse({
    spaceId: input.space,
    signalId: input.signalId,
    threadRootSignalId: input.threadRootSignalId,
  });
  const gatewayUrl = await resolveBaseUrl(input.baseUrl);
  const url = buildPublicSpaceEntryUrl({
    origin: resolveGatewayWebOrigin(gatewayUrl),
    target,
  });

  emitSpaceLinkOutput({ presenter, target, url });
}

export function emitSpaceLinkOutput(input: {
  presenter: Presenter;
  target: SpaceEntryTarget;
  url: string;
}): void {
  if (input.presenter.view === "agent") {
    input.presenter.data({
      code: "space.link",
      payload: {
        accessCommand: formatOpenMeldCliCommand(
          `openmeld space access ${JSON.stringify(input.url)} --view agent`
        ),
        grantsAccess: false,
        target: input.target,
        url: input.url,
      },
    });
    return;
  }

  input.presenter.line({
    code: "space.link",
    text: `Space link: ${input.url}`,
  });
  input.presenter.line({
    code: "space.link.access_note",
    text: "Access is still checked when someone opens it.",
  });
}
