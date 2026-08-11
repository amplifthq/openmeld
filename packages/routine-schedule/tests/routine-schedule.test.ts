import { Cron } from "croner";
import { describe, expect, it } from "vitest";
import {
  createDailyRoutineSchedule,
  formatStoredRoutineSchedule,
  getNextStoredRoutineOccurrence,
  getStoredRoutineOccurrenceWindow,
  MINIMUM_ROUTINE_INTERVAL_MINUTES,
  ROUTINE_SCHEDULE_RECOVERY_EARLIEST_MS,
  ROUTINE_SCHEDULE_RECOVERY_LATEST_MS,
  RoutineScheduleValidationError,
  validateRoutineSchedule,
} from "../src/index";

describe("Center Agent Routine schedule semantics", () => {
  it("translates strict daily local time into a validated five-field schedule", () => {
    expect(
      createDailyRoutineSchedule({
        dailyTime: "09:05",
        timezone: "America/Los_Angeles",
      })
    ).toEqual({
      cronExpression: "5 9 * * *",
      timezone: "America/Los_Angeles",
    });
  });

  it.each([
    "9:05",
    "09:5",
    " 09:05 ",
    "24:00",
    "23:60",
    "noon",
  ])("rejects invalid daily shorthand %s", (dailyTime) => {
    expect(() =>
      createDailyRoutineSchedule({ dailyTime, timezone: "UTC" })
    ).toThrow(
      expect.objectContaining({
        code: "routine.schedule.invalid_daily_time",
      })
    );
  });

  it("validates a daily shorthand timezone through the shared admission path", () => {
    expect(() =>
      createDailyRoutineSchedule({ dailyTime: "09:05", timezone: "PST" })
    ).toThrow(
      expect.objectContaining({ code: "routine.schedule.invalid_timezone" })
    );
  });

  it("accepts a five-field cron expression with an explicit IANA timezone", () => {
    expect(
      validateRoutineSchedule({
        cronExpression: "  0   9  * * * ",
        timezone: "America/Los_Angeles",
      })
    ).toEqual({
      cronExpression: "0 9 * * *",
      timezone: "America/Los_Angeles",
    });
  });

  it.each([
    ["not a cron", "routine.schedule.invalid_cron"],
    ["0 0 9 * * *", "routine.schedule.invalid_cron"],
    ["*/4 * * * *", "routine.schedule.too_frequent"],
    ["2,58 * * * *", "routine.schedule.too_frequent"],
  ])("rejects unsupported schedule %s", (cronExpression, code) => {
    expect(() =>
      validateRoutineSchedule({
        cronExpression,
        timezone: "America/Los_Angeles",
      })
    ).toThrow(expect.objectContaining({ code }));
  });

  it.each([
    "Not/A_Timezone",
    "PST",
  ])("rejects non-IANA timezone %s", (timezone) => {
    expect(() =>
      validateRoutineSchedule({ cronExpression: "0 9 * * *", timezone })
    ).toThrow(
      expect.objectContaining({ code: "routine.schedule.invalid_timezone" })
    );
  });

  it("keeps a daily local time stable across the spring DST transition", () => {
    expect(
      getNextStoredRoutineOccurrence({
        after: new Date("2026-03-07T14:00:00.000Z"),
        cronExpression: "0 9 * * *",
        timezone: "America/New_York",
      }).toISOString()
    ).toBe("2026-03-08T13:00:00.000Z");
  });

  it("keeps a daily local time stable across the fall DST transition", () => {
    expect(
      getNextStoredRoutineOccurrence({
        after: new Date("2026-10-31T13:00:00.000Z"),
        cronExpression: "0 9 * * *",
        timezone: "America/New_York",
      }).toISOString()
    ).toBe("2026-11-01T14:00:00.000Z");
  });

  it("does not skip an occurrence exactly one millisecond after the reference time", () => {
    expect(
      getNextStoredRoutineOccurrence({
        after: new Date("2026-01-01T08:59:59.999Z"),
        cronExpression: "0 9 * * *",
        timezone: "UTC",
      }).toISOString()
    ).toBe("2026-01-01T09:00:00.000Z");
  });

  it("counts a year of five-minute occurrences by calendar structure instead of occurrence enumeration", () => {
    const window = getStoredRoutineOccurrenceWindow({
      cronExpression: "*/5 * * * *",
      from: Date.parse("2025-01-01T00:00:00.000Z"),
      through: Date.parse("2025-12-31T23:59:59.999Z"),
      timezone: "UTC",
    });

    expect(window).toMatchObject({
      calendarMonthsEvaluated: 4800,
      dueCount: 105_120,
      timezoneTransitionsEvaluated: 0,
    });
    expect(window.latestDueAt.toISOString()).toBe("2025-12-31T23:55:00.000Z");
    expect(window.nextDueAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("aggregates a full Gregorian cycle with the same fixed calendar work", () => {
    const window = getStoredRoutineOccurrenceWindow({
      cronExpression: "*/5 * * * *",
      from: Date.parse("2000-01-01T00:00:00.000Z"),
      through: Date.parse("2399-12-31T23:59:59.999Z"),
      timezone: "UTC",
    });

    expect(window).toMatchObject({
      calendarMonthsEvaluated: 4800,
      dueCount: 42_075_936,
      timezoneTransitionsEvaluated: 0,
    });
    expect(window.nextDueAt.toISOString()).toBe("2400-01-01T00:00:00.000Z");
  });

  it("bounds IANA transition work with an explicit stored-timestamp recovery horizon", () => {
    const window = getStoredRoutineOccurrenceWindow({
      cronExpression: "*/5 * * * *",
      from: Date.parse("1970-01-01T08:00:00.000Z"),
      through: Date.parse("2998-12-31T07:59:59.999Z"),
      timezone: "America/Los_Angeles",
    });

    expect(window.calendarMonthsEvaluated).toBe(4800);
    expect(window.timezoneTransitionsEvaluated).toBeLessThanOrEqual(2060);
    expect(ROUTINE_SCHEDULE_RECOVERY_EARLIEST_MS).toBe(
      Date.parse("1970-01-01T00:00:00.000Z")
    );
    expect(ROUTINE_SCHEDULE_RECOVERY_LATEST_MS).toBe(
      Date.parse("2998-12-31T23:59:59.999Z")
    );
  });

  it("rejects corrupt stored timestamps outside the fixed recovery horizon", () => {
    expect(() =>
      getStoredRoutineOccurrenceWindow({
        cronExpression: "*/5 * * * *",
        from: Date.parse("1969-12-31T23:55:00.000Z"),
        through: Date.parse("2026-01-01T00:00:00.000Z"),
        timezone: "UTC",
      })
    ).toThrow(
      expect.objectContaining({
        code: "routine.schedule.invalid_reference_time",
      })
    );
    expect(() =>
      getNextStoredRoutineOccurrence({
        after: ROUTINE_SCHEDULE_RECOVERY_LATEST_MS + 1,
        cronExpression: "*/5 * * * *",
        timezone: "UTC",
      })
    ).toThrow(
      expect.objectContaining({
        code: "routine.schedule.invalid_reference_time",
      })
    );
  });

  it("corrects only real timezone transitions for a dense annual schedule", () => {
    const window = getStoredRoutineOccurrenceWindow({
      cronExpression: "*/5 * * * *",
      from: Date.parse("2026-01-01T08:00:00.000Z"),
      through: Date.parse("2027-01-01T07:59:59.999Z"),
      timezone: "America/Los_Angeles",
    });

    expect(window).toMatchObject({
      calendarMonthsEvaluated: 4800,
      dueCount: 105_108,
      timezoneTransitionsEvaluated: 2,
    });
  });

  it("counts DST gaps and overlaps with Croner semantics", () => {
    const spring = getStoredRoutineOccurrenceWindow({
      cronExpression: "30 2 * * *",
      from: Date.parse("2026-03-07T10:30:00.000Z"),
      through: Date.parse("2026-03-10T09:30:00.000Z"),
      timezone: "America/Los_Angeles",
    });
    expect(spring).toMatchObject({
      calendarMonthsEvaluated: 4800,
      dueCount: 4,
      timezoneTransitionsEvaluated: 1,
    });
    expect(spring.latestDueAt.toISOString()).toBe("2026-03-10T09:30:00.000Z");

    const fall = getStoredRoutineOccurrenceWindow({
      cronExpression: "30 1 * * *",
      from: Date.parse("2026-10-31T08:30:00.000Z"),
      through: Date.parse("2026-11-02T09:30:00.000Z"),
      timezone: "America/Los_Angeles",
    });
    expect(fall).toMatchObject({
      calendarMonthsEvaluated: 4800,
      dueCount: 3,
      timezoneTransitionsEvaluated: 1,
    });
    expect(fall.latestDueAt.toISOString()).toBe("2026-11-02T09:30:00.000Z");
  });

  it("treats a repeated local slot as one occurrence throughout the fall overlap", () => {
    const betweenRepeatedTimes = getStoredRoutineOccurrenceWindow({
      cronExpression: "30 1 * * *",
      from: Date.parse("2026-11-01T08:30:00.000Z"),
      through: Date.parse("2026-11-01T09:15:00.000Z"),
      timezone: "America/Los_Angeles",
    });
    const atRepeatedTime = getStoredRoutineOccurrenceWindow({
      cronExpression: "30 1 * * *",
      from: Date.parse("2026-11-01T08:30:00.000Z"),
      through: Date.parse("2026-11-01T09:30:00.000Z"),
      timezone: "America/Los_Angeles",
    });

    for (const window of [betweenRepeatedTimes, atRepeatedTime]) {
      expect(window.dueCount).toBe(1);
      expect(window.latestDueAt.toISOString()).toBe("2026-11-01T08:30:00.000Z");
      expect(window.nextDueAt.toISOString()).toBe("2026-11-02T09:30:00.000Z");
      expect(window.previousDueAt?.toISOString()).toBe(
        "2026-10-31T08:30:00.000Z"
      );
    }
  });

  it("accepts a stored occurrence that Croner shifted out of a DST gap", () => {
    const window = getStoredRoutineOccurrenceWindow({
      cronExpression: "30 2 * * *",
      from: Date.parse("2026-03-08T10:30:00.000Z"),
      through: Date.parse("2026-03-09T09:30:00.000Z"),
      timezone: "America/Los_Angeles",
    });

    expect(window.dueCount).toBe(2);
    expect(window.latestDueAt.toISOString()).toBe("2026-03-09T09:30:00.000Z");
    expect(window.previousDueAt?.toISOString()).toBe(
      "2026-03-08T10:30:00.000Z"
    );
  });

  it.each([
    {
      cronExpression: "0 * * * *",
      from: "1985-12-31T17:30:00.000Z",
      through: "1986-01-01T19:15:00.000Z",
      timezone: "Asia/Kathmandu",
    },
    {
      cronExpression: "0 * * * *",
      from: "1972-01-06T22:44:30.000Z",
      through: "1972-01-07T01:00:00.000Z",
      timezone: "Africa/Monrovia",
    },
    {
      cronExpression: "0 2 * * *",
      from: "2018-03-24T02:00:00.000Z",
      through: "2018-03-26T01:00:00.000Z",
      timezone: "Africa/Casablanca",
    },
  ])("matches Croner when $timezone shifts a gap occurrence without a collision", (input) => {
    const bounded = getStoredRoutineOccurrenceWindow({
      ...input,
      from: Date.parse(input.from),
      through: Date.parse(input.through),
    });
    const enumerated = enumerateRoutineOccurrences({
      ...input,
      from: Date.parse(input.from),
      through: Date.parse(input.through),
    });

    expect({
      dueCount: bounded.dueCount,
      latestDueAt: bounded.latestDueAt.toISOString(),
      nextDueAt: bounded.nextDueAt.toISOString(),
      previousDueAt: bounded.previousDueAt?.toISOString() ?? null,
    }).toEqual(enumerated);
  });

  it("counts a full skipped civil day from an IANA offset transition", () => {
    const window = getStoredRoutineOccurrenceWindow({
      cronExpression: "0 9 * * *",
      from: Date.parse("2011-12-29T19:00:00.000Z"),
      through: Date.parse("2012-01-01T19:00:00.000Z"),
      timezone: "Pacific/Apia",
    });

    expect(window).toMatchObject({
      dueCount: 4,
      timezoneTransitionsEvaluated: 1,
    });
    expect(window.latestDueAt.toISOString()).toBe("2012-01-01T19:00:00.000Z");
  });

  it.each([
    {
      cronExpression: "0,30 9-10 * * 1-5",
      from: "2026-03-02T14:00:00.000Z",
      through: "2026-03-20T23:59:59.999Z",
      timezone: "America/New_York",
    },
    {
      cronExpression: "0 9 15 * 1",
      from: "2026-01-05T09:00:00.000Z",
      through: "2026-04-30T23:59:59.999Z",
      timezone: "UTC",
    },
    {
      cronExpression: "0 9 L * *",
      from: "2026-01-31T09:00:00.000Z",
      through: "2026-12-31T23:59:59.999Z",
      timezone: "UTC",
    },
    {
      cronExpression: "0 9 15W * *",
      from: "2026-01-15T09:00:00.000Z",
      through: "2026-12-31T23:59:59.999Z",
      timezone: "UTC",
    },
    {
      cronExpression: "0 9 * * 1#2",
      from: "2026-01-12T09:00:00.000Z",
      through: "2026-12-31T23:59:59.999Z",
      timezone: "UTC",
    },
    {
      cronExpression: "0 0 29 2 *",
      from: "1972-02-29T08:00:00.000Z",
      through: "2030-12-31T23:59:59.999Z",
      timezone: "America/Los_Angeles",
    },
  ])("matches bounded Croner enumeration for $cronExpression in $timezone", (input) => {
    const bounded = getStoredRoutineOccurrenceWindow({
      ...input,
      from: Date.parse(input.from),
      through: Date.parse(input.through),
    });
    const enumerated = enumerateRoutineOccurrences({
      ...input,
      from: Date.parse(input.from),
      through: Date.parse(input.through),
    });

    expect({
      dueCount: bounded.dueCount,
      latestDueAt: bounded.latestDueAt.toISOString(),
      nextDueAt: bounded.nextDueAt.toISOString(),
      previousDueAt: bounded.previousDueAt?.toISOString() ?? null,
    }).toEqual(enumerated);
  });

  it("formats common schedules in natural North American English", () => {
    expect(
      formatStoredRoutineSchedule({
        cronExpression: "0 9 * * *",
        timezone: "America/Los_Angeles",
      })
    ).toBe("Every day at 9:00 AM (America/Los_Angeles)");
    expect(
      formatStoredRoutineSchedule({
        cronExpression: "*/5 * * * *",
        timezone: "UTC",
      })
    ).toBe("Every 5 minutes (UTC)");
  });

  it("keeps stored schedule operations cheap after admission validation", () => {
    const schedule = { cronExpression: "*/4 * * * *", timezone: "UTC" };
    expect(() => validateRoutineSchedule(schedule)).toThrow(
      expect.objectContaining({ code: "routine.schedule.too_frequent" })
    );
    expect(formatStoredRoutineSchedule(schedule)).toBe("Every 4 minutes (UTC)");
    expect(
      getNextStoredRoutineOccurrence({
        ...schedule,
        after: new Date("2026-01-01T00:00:00.000Z"),
      }).toISOString()
    ).toBe("2026-01-01T00:04:00.000Z");
  });

  it("defensively rejects invalid stored cron and timezone values", () => {
    expect(() =>
      formatStoredRoutineSchedule({
        cronExpression: "not a cron",
        timezone: "UTC",
      })
    ).toThrow(
      expect.objectContaining({ code: "routine.schedule.invalid_cron" })
    );
    expect(() =>
      getNextStoredRoutineOccurrence({
        after: Date.now(),
        cronExpression: "0 9 * * *",
        timezone: "PST",
      })
    ).toThrow(
      expect.objectContaining({ code: "routine.schedule.invalid_timezone" })
    );
  });

  it("exports the product frequency floor and a typed validation error", () => {
    expect(MINIMUM_ROUTINE_INTERVAL_MINUTES).toBe(5);
    expect(
      new RoutineScheduleValidationError(
        "routine.schedule.invalid_cron",
        "Invalid cron expression."
      )
    ).toMatchObject({
      code: "routine.schedule.invalid_cron",
      message: "Invalid cron expression.",
    });
  });
});

function enumerateRoutineOccurrences(input: {
  cronExpression: string;
  from: number;
  through: number;
  timezone: string;
}): {
  dueCount: number;
  latestDueAt: string;
  nextDueAt: string;
  previousDueAt: string | null;
} {
  const cron = new Cron(input.cronExpression, {
    mode: "5-part",
    paused: true,
    timezone: input.timezone,
  });
  const occurrences = [new Date(input.from)];
  let nextDueAt = cron.nextRun(new Date(input.from));
  if (!nextDueAt) {
    throw new Error("Expected a next enumerated Routine occurrence");
  }
  while (nextDueAt.getTime() <= input.through) {
    occurrences.push(nextDueAt);
    const next = cron.nextRun(nextDueAt);
    if (!next) {
      throw new Error("Expected a next enumerated Routine occurrence");
    }
    nextDueAt = next;
  }
  const latestDueAt = occurrences.at(-1);
  if (!latestDueAt) {
    throw new Error("Expected at least one enumerated Routine occurrence");
  }
  return {
    dueCount: occurrences.length,
    latestDueAt: latestDueAt.toISOString(),
    nextDueAt: nextDueAt.toISOString(),
    previousDueAt: occurrences.at(-2)?.toISOString() ?? null,
  };
}
