import { describe, expect, it, vi } from "vitest";

vi.mock("@openmeld/db/postgresql", () => ({
  withPostgresRequest: (_postgres: unknown, run: () => Promise<void>) => run(),
}));

import {
  SpaceMemberDisplayRefresh,
  type SpaceMemberDisplayRefreshScope,
} from "../src/space/application/space-member-display-refresh";

describe("SpaceMemberDisplayRefresh", () => {
  it("runs a scope requested during a run once that run settles", async () => {
    const scopes: SpaceMemberDisplayRefreshScope[] = [];
    let release: () => void = () => undefined;
    const runs: Promise<unknown>[] = [];
    const refresh = new SpaceMemberDisplayRefresh({
      postgres: () => ({}) as never,
      refresh: async (scope) => {
        scopes.push(scope);
        if (scopes.length === 1) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return false;
      },
      onChanged: async () => undefined,
      onError: (error) => {
        throw error;
      },
      waitUntil: (promise) => {
        runs.push(promise);
      },
    });

    refresh.start({ names: true, ownerAvatars: false });
    refresh.start({ names: false, ownerAvatars: true });
    refresh.start({ names: true, ownerAvatars: false });
    expect(scopes).toEqual([{ names: true, ownerAvatars: false }]);

    release();
    await runs[0];
    await runs[1];
    expect(scopes).toEqual([
      { names: true, ownerAvatars: false },
      { names: true, ownerAvatars: true },
    ]);
    expect(runs).toHaveLength(2);
  });
});
