import { withPostgresRequest } from "@openmeld/db/postgresql";
import type { CoreBindings } from "../../lib/bindings";

export type SpaceMemberDisplayRefreshScope = {
  names: boolean;
  ownerAvatars: boolean;
};

// Runs one background refresh of member display copies at a time. Each run
// owns its PostgreSQL scope because the request that started it closes its
// own pool when it responds.
export class SpaceMemberDisplayRefresh {
  private inFlight: Promise<void> | null = null;
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
    if (this.inFlight || !(scope.names || scope.ownerAvatars)) {
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
      });
    this.inFlight = run;
    this.input.waitUntil(run);
  }
}
