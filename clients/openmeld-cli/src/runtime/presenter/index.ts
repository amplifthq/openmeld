import type { RuntimeContext } from "../types";
import { createAgentPresenter } from "./agent";
import { createHumanPresenter } from "./human";
import type { Presenter } from "./types";

export function createPresenter(context: RuntimeContext): Presenter {
  return context.resolvedView === "agent"
    ? createAgentPresenter({ context })
    : createHumanPresenter({ context });
}

export type { Presenter } from "./types";
