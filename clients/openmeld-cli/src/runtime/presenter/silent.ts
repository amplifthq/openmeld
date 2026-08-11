import type { ResolvedCliView } from "../types";
import type { Presenter } from "./types";

/**
 * A presenter that drops every output call. Used for the `--json` entry-check
 * flow so advisory check output never pollutes the single machine-readable line
 * a `--json` consumer expects on stdout. Blocking checks surface their canonical
 * error envelope separately via the CLI error JSON helper.
 */
export function createSilentPresenter(view: ResolvedCliView): Presenter {
  return {
    view,
    event: () => undefined,
    line: () => undefined,
    data: () => undefined,
  };
}
