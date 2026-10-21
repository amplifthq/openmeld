import { withPostgresRequest } from "@openmeld/db/postgresql";
import type { CoreBindings } from "../../lib/bindings";

export type SpaceMemberDisplayRefreshScope = {
  names: boolean;
  ownerAvatars: boolean;
};

// Runs one background refresh of member display copies at a time. A scope
// requested during a run is merged and runs once the current run settles, so
// a caller that served a stale copy always gets its refresh. Each run owns its
// PostgreSQL scope because the request that started it closes its own pool
// when it responds.
export class SpaceMemberDisplayRefresh {
  private inFlight: Promise<void> | null = null;
  private pending: SpaceMemberDisplayRefreshScope | null = null;
  private readonly input: {
    postgres: () => CoreBindings["OPENMELD_POSTGRESQL"];
    // Returns true when a stored display value changed.
    refresh: (scope: SpaceMemberDisplayRefreshScope) => Promise<boolean>;
    onChanged: () => Promise<void>;
    onError: (error: unknown) => void;
    waitUntil: (promise: Promise<unknown>) => void;
  };

  constructor(input: SpaceMemberDisplayRefresh["input"]) {
    this.input = input;
  }

  start(scope: SpaceMemberDisplayRefreshScope): void {
    if (!(scope.names || scope.ownerAvatars)) {
      return;
    }
    if (this.inFlight) {
      this.pending = {
        names: scope.names || (this.pending?.names ?? false),
        ownerAvatars:
          scope.ownerAvatars || (this.pending?.ownerAvatars ?? false),
      };
      return;
    }
    const run = withPostgresRequest(
      this.input.postgres(),
      async () => {
        if (await this.input.refresh(scope)) {
          await this.input.onChanged();
        }
      },
      { reuseConnection: false }
    )
      .catch(this.input.onError)
      .finally(() => {
        this.inFlight = null;
        const next = this.pending;
        this.pending = null;
        if (next) {
          this.start(next);
        }
      });
    this.inFlight = run;
    this.input.waitUntil(run);
  }
}
