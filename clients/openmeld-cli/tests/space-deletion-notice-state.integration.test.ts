import { describe, expect, it, vi } from "vitest";
import {
  readSpaceCacheDeletionNoticeState,
  writeSpaceCacheDeletionNoticeState,
} from "../src/space/local-state";
import { withTempHome } from "./helpers/fs";
import { expectSpaceCacheDeletionNoticeStateValue } from "./helpers/local-state";

describe("space deletion notice state", () => {
  it("reads back stored seen entries", async () => {
    vi.useFakeTimers();
    try {
      await withTempHome(async () => {
        vi.setSystemTime(new Date("2026-03-12T08:00:00.000Z"));
        await writeSpaceCacheDeletionNoticeState({
          openMeldProfileId: "mira--aaaa1111",
          seen: {
            "gateway.openmeld.invalid:space-alpha": "2026-03-12T08:00:00.000Z",
          },
        });

        await expect(
          readSpaceCacheDeletionNoticeState({
            openMeldProfileId: "mira--aaaa1111",
          }).then(expectSpaceCacheDeletionNoticeStateValue)
        ).resolves.toEqual({
          v: 1,
          seen: {
            "gateway.openmeld.invalid:space-alpha": "2026-03-12T08:00:00.000Z",
          },
        });
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("prunes entries older than 90 days on read", async () => {
    vi.useFakeTimers();
    try {
      await withTempHome(async () => {
        vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
        await writeSpaceCacheDeletionNoticeState({
          openMeldProfileId: "mira--aaaa1111",
          seen: {
            "gateway.openmeld.invalid:space-alpha": "2026-01-01T00:00:00.000Z",
            "gateway.openmeld.invalid:space-beta": "2026-01-14T00:00:00.000Z",
          },
        });

        vi.setSystemTime(new Date("2026-04-15T00:00:00.000Z"));
        await expect(
          readSpaceCacheDeletionNoticeState({
            openMeldProfileId: "mira--aaaa1111",
          }).then(expectSpaceCacheDeletionNoticeStateValue)
        ).resolves.toEqual({
          v: 1,
          seen: {},
        });
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("prunes stale entries before persisting new state", async () => {
    vi.useFakeTimers();
    try {
      await withTempHome(async () => {
        vi.setSystemTime(new Date("2026-04-15T00:00:00.000Z"));
        await writeSpaceCacheDeletionNoticeState({
          openMeldProfileId: "mira--aaaa1111",
          seen: {
            "gateway.openmeld.invalid:space-alpha": "2026-01-01T00:00:00.000Z",
            "gateway.openmeld.invalid:space-beta": "2026-04-10T00:00:00.000Z",
          },
        });

        await expect(
          readSpaceCacheDeletionNoticeState({
            openMeldProfileId: "mira--aaaa1111",
          }).then(expectSpaceCacheDeletionNoticeStateValue)
        ).resolves.toEqual({
          v: 1,
          seen: {
            "gateway.openmeld.invalid:space-beta": "2026-04-10T00:00:00.000Z",
          },
        });
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
