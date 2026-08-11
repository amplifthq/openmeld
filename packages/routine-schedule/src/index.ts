import { Temporal } from "@js-temporal/polyfill";
import { Cron, CronDate, CronPattern } from "croner";

export const MINIMUM_ROUTINE_INTERVAL_MINUTES = 5;
// Stored Routine dates are D1 epoch timestamps created by OpenMeld, so anything
// before the Unix epoch is corrupt. Croner 10's recurring-year search ends at
// year 3000. This validity horizon bounds IANA transition work by construction;
// Core quarantines out-of-range rows instead of repeatedly poisoning due scans.
export const ROUTINE_SCHEDULE_RECOVERY_EARLIEST_MS = Date.UTC(1970, 0, 1);
export const ROUTINE_SCHEDULE_RECOVERY_LATEST_MS = Date.UTC(2999, 0, 1) - 1;

const MINIMUM_ROUTINE_INTERVAL_MS =
  MINIMUM_ROUTINE_INTERVAL_MINUTES * 60 * 1000;
const FREQUENCY_VALIDATION_OCCURRENCE_COUNT = 513;
const FREQUENCY_VALIDATION_START = new Date("2000-01-01T00:00:00.000Z");
const CRON_FIELD_SEPARATOR_PATTERN = /\s+/u;
const DAILY_TIME_PATTERN = /^(?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d)$/u;
const MINUTE_STEP_PATTERN = /^\*\/(\d+)$/u;
const ONE_OR_TWO_DIGITS_PATTERN = /^\d{1,2}$/u;
const GREGORIAN_CALENDAR_CYCLE_BASE_YEAR = 2000;
const GREGORIAN_CALENDAR_CYCLE_MONTHS = 400 * 12;

export type RoutineScheduleValidationErrorCode =
  | "routine.schedule.invalid_daily_time"
  | "routine.schedule.invalid_cron"
  | "routine.schedule.invalid_reference_time"
  | "routine.schedule.invalid_timezone"
  | "routine.schedule.too_frequent";

export type RoutineSchedule = {
  cronExpression: string;
  timezone: string;
};

export type DailyRoutineScheduleInput = {
  dailyTime: string;
  timezone: string;
};

export class RoutineScheduleValidationError extends Error {
  readonly code: RoutineScheduleValidationErrorCode;

  constructor(code: RoutineScheduleValidationErrorCode, message: string) {
    super(message);
    this.name = "RoutineScheduleValidationError";
    this.code = code;
  }
}

export function createDailyRoutineSchedule(
  input: DailyRoutineScheduleInput
): RoutineSchedule {
  const match = DAILY_TIME_PATTERN.exec(input.dailyTime);
  const hour = match?.groups?.hour;
  const minute = match?.groups?.minute;
  if (!(hour && minute)) {
    throw new RoutineScheduleValidationError(
      "routine.schedule.invalid_daily_time",
      "Daily time must use 24-hour HH:MM format, such as 09:00."
    );
  }

  return validateRoutineSchedule({
    cronExpression: `${Number(minute)} ${Number(hour)} * * *`,
    timezone: input.timezone,
  });
}

export function validateRoutineSchedule(
  input: RoutineSchedule
): RoutineSchedule {
  const storedSchedule = parseStoredRoutineSchedule(input);

  assertMinimumFrequency(storedSchedule.cron);

  return {
    cronExpression: storedSchedule.cronExpression,
    timezone: storedSchedule.timezone,
  };
}

export function getNextStoredRoutineOccurrence(
  input: RoutineSchedule & { after: Date | number }
): Date {
  const schedule = parseStoredRoutineSchedule(input);
  const afterMs =
    input.after instanceof Date ? input.after.getTime() : input.after;
  if (!Number.isFinite(afterMs)) {
    throw new RoutineScheduleValidationError(
      "routine.schedule.invalid_reference_time",
      "Routine schedule reference time must be a valid timestamp."
    );
  }
  assertSupportedRoutineScheduleReferenceTime(afterMs);

  return new Date(
    findNextCanonicalStoredRoutineOccurrence(schedule, afterMs).instantMs
  );
}

export type StoredRoutineOccurrenceWindow = {
  calendarMonthsEvaluated: number;
  dueCount: number;
  latestDueAt: Date;
  nextDueAt: Date;
  previousDueAt: Date | null;
  timezoneTransitionsEvaluated: number;
};

export function getStoredRoutineOccurrenceWindow(
  input: RoutineSchedule & { from: Date | number; through: Date | number }
): StoredRoutineOccurrenceWindow {
  const schedule = parseStoredRoutineSchedule(input);
  const fromMs = toReferenceTime(input.from);
  const throughMs = toReferenceTime(input.through);
  assertSupportedRoutineScheduleReferenceTime(fromMs);
  assertSupportedRoutineScheduleReferenceTime(throughMs);
  if (fromMs > throughMs) {
    throw invalidReferenceTimeError();
  }
  const nominalCalendar = createRoutineNominalCalendar(schedule);
  const fromOccurrence = resolveCanonicalStoredRoutineOccurrenceAt(
    schedule,
    fromMs
  );
  const latestRaw = findPreviousStoredRoutineOccurrence(
    schedule,
    nominalCalendar,
    throughMs
  );
  if (!fromOccurrence || latestRaw.instantMs < fromMs) {
    throw invalidReferenceTimeError();
  }
  const latestOccurrence = requireCanonicalStoredRoutineOccurrenceAt(
    schedule,
    latestRaw.instantMs
  );
  const nextDueAt = getNextStoredRoutineOccurrence({
    after: throughMs,
    cronExpression: schedule.cronExpression,
    timezone: schedule.timezone,
  });
  const previousRaw = findPreviousStoredRoutineOccurrence(
    schedule,
    nominalCalendar,
    latestOccurrence.instantMs - 1
  );
  const previousOccurrence = resolveCanonicalStoredRoutineOccurrenceAt(
    schedule,
    previousRaw.instantMs
  );
  const counts = countStoredRoutineOccurrences({
    fromOccurrence,
    nominalCalendar,
    schedule,
    throughOccurrence: latestOccurrence,
  });
  return {
    ...counts,
    latestDueAt: new Date(latestOccurrence.instantMs),
    nextDueAt,
    previousDueAt: previousOccurrence
      ? new Date(previousOccurrence.instantMs)
      : null,
  };
}

type ParsedStoredRoutineSchedule = ReturnType<
  typeof parseStoredRoutineSchedule
>;

type CanonicalStoredRoutineOccurrence = {
  instantMs: number;
  nominal: Temporal.PlainDateTime;
};

type RoutineOccurrenceCountingContext = {
  calendarCycle: RoutineCalendarCycle;
  fromLocal: CronDate;
  fromMs: number;
  fromNominal: Temporal.PlainDateTime;
  pattern: CronPattern;
  schedule: ParsedStoredRoutineSchedule;
  selectedLocalMinutes: number[];
  throughLocal: CronDate;
  throughMs: number;
  throughNominal: Temporal.PlainDateTime;
};

type RoutineNominalCalendar = {
  calendarCycle: RoutineCalendarCycle;
  pattern: CronPattern;
  selectedLocalMinutes: number[];
};

type RoutineCalendarCycle = {
  matchingDatesBeforeMonth: Float64Array;
  matchingDatesPerCycle: number;
  monthDayMasks: Uint32Array;
};

function resolveCanonicalStoredRoutineOccurrenceAt(
  schedule: ParsedStoredRoutineSchedule,
  instantMs: number
): CanonicalStoredRoutineOccurrence | null {
  if (
    instantMs < ROUTINE_SCHEDULE_RECOVERY_EARLIEST_MS ||
    instantMs > ROUTINE_SCHEDULE_RECOVERY_LATEST_MS
  ) {
    return null;
  }
  const candidate = findNextCanonicalStoredRoutineOccurrence(
    schedule,
    instantMs - 1
  );
  return candidate.instantMs === instantMs ? candidate : null;
}

function requireCanonicalStoredRoutineOccurrenceAt(
  schedule: ParsedStoredRoutineSchedule,
  instantMs: number
): CanonicalStoredRoutineOccurrence {
  const occurrence = resolveCanonicalStoredRoutineOccurrenceAt(
    schedule,
    instantMs
  );
  if (!occurrence) {
    throw invalidReferenceTimeError();
  }
  return occurrence;
}

function findNextCanonicalStoredRoutineOccurrence(
  schedule: ParsedStoredRoutineSchedule,
  afterMs: number
): CanonicalStoredRoutineOccurrence {
  let nominalReference = resolveNextNominalSearchStart(schedule, afterMs);
  while (true) {
    const nominalRun = schedule.nominalCron.nextRun(
      new Date(plainDateTimeAsUtcMs(nominalReference))
    );
    if (!nominalRun) {
      throw invalidCronError();
    }
    const nominal = plainDateTimeFromUtcDate(nominalRun);
    const instantMs = mapNominalRoutineOccurrenceToInstant(schedule, nominal);
    if (instantMs > afterMs) {
      assertSupportedRoutineScheduleReferenceTime(instantMs);
      return { instantMs, nominal };
    }
    nominalReference = nominal;
  }
}

function findPreviousStoredRoutineOccurrence(
  schedule: ParsedStoredRoutineSchedule,
  nominalCalendar: RoutineNominalCalendar,
  atOrBeforeMs: number
): CanonicalStoredRoutineOccurrence {
  const nominalReference = resolvePreviousNominalSearchStart(
    schedule,
    atOrBeforeMs
  );
  const nominal = findPreviousNominalRoutineOccurrence(
    nominalCalendar,
    nominalReference
  );
  const instantMs = mapNominalRoutineOccurrenceToInstant(schedule, nominal);
  if (instantMs <= atOrBeforeMs) {
    return { instantMs, nominal };
  }

  // During a forward offset jump, a nominal time in the missing local window
  // is shifted into the following real-time window. If that shifted instant is
  // still in the future, retry once at the exact pre-shift local boundary.
  // This is structural DST disambiguation, not occurrence enumeration.
  const correctedReference = resolvePreviousForwardGapSearchStart(
    schedule,
    atOrBeforeMs
  );
  const correctedNominal = findPreviousNominalRoutineOccurrence(
    nominalCalendar,
    correctedReference
  );
  const correctedInstantMs = mapNominalRoutineOccurrenceToInstant(
    schedule,
    correctedNominal
  );
  if (correctedInstantMs > atOrBeforeMs) {
    throw invalidReferenceTimeError();
  }
  return { instantMs: correctedInstantMs, nominal: correctedNominal };
}

function findPreviousNominalRoutineOccurrence(
  nominalCalendar: RoutineNominalCalendar,
  atOrBefore: Temporal.PlainDateTime
): Temporal.PlainDateTime {
  let year = atOrBefore.year;
  let month = atOrBefore.month - 1;
  for (
    let evaluatedMonths = 0;
    evaluatedMonths < GREGORIAN_CALENDAR_CYCLE_MONTHS;
    evaluatedMonths += 1
  ) {
    const dayMask = getRoutineCalendarMonthDayMask(
      nominalCalendar.calendarCycle,
      year,
      month
    );
    const isReferenceMonth = evaluatedMonths === 0;
    const throughDay = isReferenceMonth
      ? atOrBefore.day
      : getDaysInMonth(year, month);
    for (let day = throughDay; day >= 1; day -= 1) {
      if (!dayMaskIncludes(dayMask, day)) {
        continue;
      }
      const isReferenceDate = isReferenceMonth && day === atOrBefore.day;
      const throughMinute = isReferenceDate
        ? atOrBefore.hour * 60 + atOrBefore.minute
        : 24 * 60 - 1;
      const selectedMinuteIndex =
        lowerBound(nominalCalendar.selectedLocalMinutes, throughMinute + 1) - 1;
      const selectedMinute =
        nominalCalendar.selectedLocalMinutes[selectedMinuteIndex];
      if (selectedMinute === undefined) {
        continue;
      }
      return Temporal.PlainDateTime.from({
        day,
        hour: Math.floor(selectedMinute / 60),
        minute: selectedMinute % 60,
        month: month + 1,
        year,
      });
    }
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  throw invalidReferenceTimeError();
}

function resolveNextNominalSearchStart(
  schedule: ParsedStoredRoutineSchedule,
  afterMs: number
): Temporal.PlainDateTime {
  const reference = Temporal.Instant.fromEpochMilliseconds(
    afterMs
  ).toZonedDateTimeISO(schedule.timezone);
  const localReference = reference.toPlainDateTime();
  const previousTransition = reference.getTimeZoneTransition("previous");
  if (!previousTransition) {
    return localReference;
  }
  const beforeTransition = Temporal.Instant.fromEpochNanoseconds(
    previousTransition.epochNanoseconds - 1n
  ).toZonedDateTimeISO(schedule.timezone);
  const offsetDeltaNanoseconds =
    previousTransition.offsetNanoseconds - beforeTransition.offsetNanoseconds;
  if (offsetDeltaNanoseconds <= 0) {
    return localReference;
  }
  const gapEnd = previousTransition.toPlainDateTime();
  const mappedGapEnd = gapEnd.add({
    nanoseconds: offsetDeltaNanoseconds,
  });
  if (
    Temporal.PlainDateTime.compare(localReference, gapEnd) >= 0 &&
    Temporal.PlainDateTime.compare(localReference, mappedGapEnd) < 0
  ) {
    return beforeTransition
      .toPlainDateTime()
      .add({ nanoseconds: 1 })
      .subtract({ seconds: 1 });
  }
  return localReference;
}

function resolvePreviousNominalSearchStart(
  schedule: ParsedStoredRoutineSchedule,
  atOrBeforeMs: number
): Temporal.PlainDateTime {
  const reference = Temporal.Instant.fromEpochMilliseconds(
    atOrBeforeMs
  ).toZonedDateTimeISO(schedule.timezone);
  const localReference = reference.toPlainDateTime();
  const previousTransition = reference.getTimeZoneTransition("previous");
  if (!previousTransition) {
    return localReference;
  }
  const beforeTransition = Temporal.Instant.fromEpochNanoseconds(
    previousTransition.epochNanoseconds - 1n
  ).toZonedDateTimeISO(schedule.timezone);
  if (
    previousTransition.offsetNanoseconds >= beforeTransition.offsetNanoseconds
  ) {
    return localReference;
  }
  const repeatedStart = previousTransition.toPlainDateTime();
  const repeatedEnd = beforeTransition
    .toPlainDateTime()
    .add({ nanoseconds: 1 });
  if (
    Temporal.PlainDateTime.compare(localReference, repeatedStart) >= 0 &&
    Temporal.PlainDateTime.compare(localReference, repeatedEnd) < 0
  ) {
    return repeatedEnd;
  }
  return localReference;
}

function resolvePreviousForwardGapSearchStart(
  schedule: ParsedStoredRoutineSchedule,
  atOrBeforeMs: number
): Temporal.PlainDateTime {
  const reference = Temporal.Instant.fromEpochMilliseconds(
    atOrBeforeMs
  ).toZonedDateTimeISO(schedule.timezone);
  const localReference = reference.toPlainDateTime();
  const previousTransition = reference.getTimeZoneTransition("previous");
  if (!previousTransition) {
    throw invalidReferenceTimeError();
  }
  const beforeTransition = Temporal.Instant.fromEpochNanoseconds(
    previousTransition.epochNanoseconds - 1n
  ).toZonedDateTimeISO(schedule.timezone);
  const offsetDeltaNanoseconds =
    previousTransition.offsetNanoseconds - beforeTransition.offsetNanoseconds;
  const gapEnd = previousTransition.toPlainDateTime();
  const mappedGapEnd = gapEnd.add({ nanoseconds: offsetDeltaNanoseconds });
  if (
    offsetDeltaNanoseconds <= 0 ||
    Temporal.PlainDateTime.compare(localReference, gapEnd) < 0 ||
    Temporal.PlainDateTime.compare(localReference, mappedGapEnd) >= 0
  ) {
    throw invalidReferenceTimeError();
  }
  return localReference.subtract({ nanoseconds: offsetDeltaNanoseconds });
}

function mapNominalRoutineOccurrenceToInstant(
  schedule: ParsedStoredRoutineSchedule,
  nominal: Temporal.PlainDateTime
): number {
  return nominal.toZonedDateTime(schedule.timezone, {
    disambiguation: "compatible",
  }).epochMilliseconds;
}

function plainDateTimeAsUtcMs(value: Temporal.PlainDateTime): number {
  return value.toZonedDateTime("UTC").epochMilliseconds;
}

function plainDateTimeFromUtcDate(value: Date): Temporal.PlainDateTime {
  return Temporal.Instant.fromEpochMilliseconds(value.getTime())
    .toZonedDateTimeISO("UTC")
    .toPlainDateTime();
}

function countStoredRoutineOccurrences(input: {
  fromOccurrence: CanonicalStoredRoutineOccurrence;
  nominalCalendar: RoutineNominalCalendar;
  schedule: ParsedStoredRoutineSchedule;
  throughOccurrence: CanonicalStoredRoutineOccurrence;
}): Pick<
  StoredRoutineOccurrenceWindow,
  "calendarMonthsEvaluated" | "dueCount" | "timezoneTransitionsEvaluated"
> {
  const context = createRoutineOccurrenceCountingContext(input);
  const baseDueCount = countRoutineOccurrencesByCalendar(context);
  const transitionCorrection =
    countCollidingRoutineOccurrencesAtTransitions(context);
  return {
    calendarMonthsEvaluated: GREGORIAN_CALENDAR_CYCLE_MONTHS,
    dueCount: baseDueCount - transitionCorrection.collidingOccurrences,
    timezoneTransitionsEvaluated:
      transitionCorrection.timezoneTransitionsEvaluated,
  };
}

function createRoutineOccurrenceCountingContext(input: {
  fromOccurrence: CanonicalStoredRoutineOccurrence;
  nominalCalendar: RoutineNominalCalendar;
  schedule: ParsedStoredRoutineSchedule;
  throughOccurrence: CanonicalStoredRoutineOccurrence;
}): RoutineOccurrenceCountingContext {
  const fromLocal = createCronDateFromNominal(input.fromOccurrence.nominal);
  const throughLocal = createCronDateFromNominal(
    input.throughOccurrence.nominal
  );
  return {
    calendarCycle: input.nominalCalendar.calendarCycle,
    fromLocal,
    fromMs: input.fromOccurrence.instantMs,
    fromNominal: input.fromOccurrence.nominal,
    pattern: input.nominalCalendar.pattern,
    schedule: input.schedule,
    selectedLocalMinutes: input.nominalCalendar.selectedLocalMinutes,
    throughLocal,
    throughMs: input.throughOccurrence.instantMs,
    throughNominal: input.throughOccurrence.nominal,
  };
}

function createRoutineNominalCalendar(
  schedule: ParsedStoredRoutineSchedule
): RoutineNominalCalendar {
  const pattern = new CronPattern(schedule.cronExpression, schedule.timezone, {
    mode: "5-part",
  });
  return {
    calendarCycle: buildRoutineCalendarCycle(pattern),
    pattern,
    selectedLocalMinutes: selectedIndexes(pattern.hour).flatMap((hour) =>
      selectedIndexes(pattern.minute).map((minute) => hour * 60 + minute)
    ),
  };
}

function buildRoutineCalendarCycle(pattern: CronPattern): RoutineCalendarCycle {
  const monthDayMasks = new Uint32Array(GREGORIAN_CALENDAR_CYCLE_MONTHS);
  const matchingDatesBeforeMonth = new Float64Array(
    GREGORIAN_CALENDAR_CYCLE_MONTHS + 1
  );
  for (
    let monthIndex = 0;
    monthIndex < GREGORIAN_CALENDAR_CYCLE_MONTHS;
    monthIndex += 1
  ) {
    const year =
      GREGORIAN_CALENDAR_CYCLE_BASE_YEAR + Math.floor(monthIndex / 12);
    const month = monthIndex % 12;
    const dayMask = buildRoutineCalendarMonthDayMask({
      month,
      pattern,
      year,
    });
    monthDayMasks[monthIndex] = dayMask;
    matchingDatesBeforeMonth[monthIndex + 1] =
      (matchingDatesBeforeMonth[monthIndex] ?? 0) +
      countDaysInMask(dayMask, 31);
  }
  return {
    matchingDatesBeforeMonth,
    matchingDatesPerCycle:
      matchingDatesBeforeMonth[GREGORIAN_CALENDAR_CYCLE_MONTHS] ?? 0,
    monthDayMasks,
  };
}

function buildRoutineCalendarMonthDayMask(input: {
  month: number;
  pattern: CronPattern;
  year: number;
}): number {
  if (!input.pattern.month[input.month]) {
    return 0;
  }
  const daysInMonth = getDaysInMonth(input.year, input.month);
  const dayOfMonthMask = buildRoutineDayOfMonthMask({
    ...input,
    daysInMonth,
  });
  if (input.pattern.starDOW) {
    return dayOfMonthMask;
  }
  const dayOfWeekMask = buildRoutineDayOfWeekMask({
    ...input,
    daysInMonth,
  });
  return combineRoutineCalendarDayMasks({
    dayOfMonthMask,
    dayOfWeekMask,
    daysInMonth,
    pattern: input.pattern,
  });
}

function buildRoutineDayOfMonthMask(input: {
  daysInMonth: number;
  month: number;
  pattern: CronPattern;
  year: number;
}): number {
  let mask = 0;
  for (let index = 0; index < input.pattern.day.length; index += 1) {
    if (input.pattern.day[index] && index < input.daysInMonth) {
      mask = addDayToMask(mask, index + 1);
    }
  }
  for (
    let index = 0;
    index < input.pattern.nearestWeekdays.length;
    index += 1
  ) {
    if (!input.pattern.nearestWeekdays[index]) {
      continue;
    }
    const nearest = getNearestWeekday(input.year, input.month, index + 1);
    if (nearest !== null) {
      mask = addDayToMask(mask, nearest);
    }
  }
  if (input.pattern.lastDayOfMonth) {
    mask = addDayToMask(mask, input.daysInMonth);
  }
  if (input.pattern.lastWeekday) {
    mask = addDayToMask(
      mask,
      getLastWeekday(input.year, input.month, input.daysInMonth)
    );
  }
  return mask;
}

function buildRoutineDayOfWeekMask(input: {
  daysInMonth: number;
  month: number;
  pattern: CronPattern;
  year: number;
}): number {
  const firstDayOfWeek = getDayOfWeek(input.year, input.month, 1);
  let mask = 0;
  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
    const selection = input.pattern.dayOfWeek[dayOfWeek] ?? 0;
    if (!selection) {
      continue;
    }
    const firstDay = 1 + ((dayOfWeek - firstDayOfWeek + 7) % 7);
    let occurrence = 1;
    for (
      let day = firstDay;
      day <= input.daysInMonth;
      day += 7, occurrence += 1
    ) {
      const nthSelection = 2 ** (occurrence - 1);
      const isLastOccurrence = day + 7 > input.daysInMonth;
      if (
        selectionIncludes(selection, nthSelection) ||
        (selectionIncludes(selection, 32) && isLastOccurrence)
      ) {
        mask = addDayToMask(mask, day);
      }
    }
  }
  return mask;
}

function combineRoutineCalendarDayMasks(input: {
  dayOfMonthMask: number;
  dayOfWeekMask: number;
  daysInMonth: number;
  pattern: CronPattern;
}): number {
  let combined = 0;
  for (let day = 1; day <= input.daysInMonth; day += 1) {
    const dayOfMonthMatches = dayMaskIncludes(input.dayOfMonthMask, day);
    const dayOfWeekMatches = dayMaskIncludes(input.dayOfWeekMask, day);
    const matches =
      input.pattern.useAndLogic || input.pattern.starDOM
        ? dayOfMonthMatches && dayOfWeekMatches
        : dayOfMonthMatches || dayOfWeekMatches;
    if (matches) {
      combined = addDayToMask(combined, day);
    }
  }
  return combined;
}

function countRoutineOccurrencesByCalendar(
  context: RoutineOccurrenceCountingContext
): number {
  const matchingDates =
    countMatchingRoutineDatesBefore(
      context,
      context.throughLocal.year,
      context.throughLocal.month,
      context.throughLocal.day + 1
    ) -
    countMatchingRoutineDatesBefore(
      context,
      context.fromLocal.year,
      context.fromLocal.month,
      context.fromLocal.day
    );
  const selectedTimesPerDate = context.selectedLocalMinutes.length;
  const sameDate = localDatesEqual(context.fromLocal, context.throughLocal);
  const firstDateMatches = routineCalendarDateMatches(context, {
    day: context.fromLocal.day,
    month: context.fromLocal.month,
    year: context.fromLocal.year,
  });
  if (sameDate) {
    return firstDateMatches
      ? countSortedValuesInRange(
          context.selectedLocalMinutes,
          context.fromLocal.hour * 60 + context.fromLocal.minute,
          context.throughLocal.hour * 60 + context.throughLocal.minute + 1
        )
      : 0;
  }
  let dueCount = matchingDates * selectedTimesPerDate;
  if (firstDateMatches) {
    dueCount -= countSortedValuesInRange(
      context.selectedLocalMinutes,
      0,
      context.fromLocal.hour * 60 + context.fromLocal.minute
    );
  }
  if (
    routineCalendarDateMatches(context, {
      day: context.throughLocal.day,
      month: context.throughLocal.month,
      year: context.throughLocal.year,
    })
  ) {
    dueCount -= countSortedValuesInRange(
      context.selectedLocalMinutes,
      context.throughLocal.hour * 60 + context.throughLocal.minute + 1,
      24 * 60
    );
  }
  return dueCount;
}

function countMatchingRoutineDatesBefore(
  context: RoutineOccurrenceCountingContext,
  year: number,
  month: number,
  day: number
): number {
  const relativeMonth =
    (year - GREGORIAN_CALENDAR_CYCLE_BASE_YEAR) * 12 + month;
  const completeCycles = Math.floor(
    relativeMonth / GREGORIAN_CALENDAR_CYCLE_MONTHS
  );
  const monthInCycle =
    relativeMonth - completeCycles * GREGORIAN_CALENDAR_CYCLE_MONTHS;
  const matchingBeforeMonth =
    completeCycles * context.calendarCycle.matchingDatesPerCycle +
    (context.calendarCycle.matchingDatesBeforeMonth[monthInCycle] ?? 0);
  const monthMask = context.calendarCycle.monthDayMasks[monthInCycle] ?? 0;
  return matchingBeforeMonth + countDaysInMask(monthMask, day - 1);
}

function routineCalendarDateMatches(
  context: RoutineOccurrenceCountingContext,
  date: { day: number; month: number; year: number }
): boolean {
  return dayMaskIncludes(
    getRoutineCalendarMonthDayMask(
      context.calendarCycle,
      date.year,
      date.month
    ),
    date.day
  );
}

function getRoutineCalendarMonthDayMask(
  calendarCycle: RoutineCalendarCycle,
  year: number,
  month: number
): number {
  const relativeMonth =
    (year - GREGORIAN_CALENDAR_CYCLE_BASE_YEAR) * 12 + month;
  const completeCycles = Math.floor(
    relativeMonth / GREGORIAN_CALENDAR_CYCLE_MONTHS
  );
  const monthInCycle =
    relativeMonth - completeCycles * GREGORIAN_CALENDAR_CYCLE_MONTHS;
  return calendarCycle.monthDayMasks[monthInCycle] ?? 0;
}

function countCollidingRoutineOccurrencesAtTransitions(
  context: RoutineOccurrenceCountingContext
): {
  collidingOccurrences: number;
  timezoneTransitionsEvaluated: number;
} {
  let collidingOccurrences = 0;
  let timezoneTransitionsEvaluated = 0;
  let transition = findFirstRelevantTimeZoneTransition(context);
  while (transition && transition.epochMilliseconds <= context.throughMs) {
    timezoneTransitionsEvaluated += 1;
    const beforeTransition = Temporal.Instant.fromEpochNanoseconds(
      transition.epochNanoseconds - 1n
    ).toZonedDateTimeISO(context.schedule.timezone);
    if (transition.offsetNanoseconds > beforeTransition.offsetNanoseconds) {
      collidingOccurrences += countRoutineOccurrenceCollisionsInForwardGap({
        context,
        offsetDeltaNanoseconds:
          transition.offsetNanoseconds - beforeTransition.offsetNanoseconds,
        gapEnd: transition.toPlainDateTime(),
        gapStart: beforeTransition.toPlainDateTime().add({ nanoseconds: 1 }),
      });
    }
    transition = transition.getTimeZoneTransition("next");
  }
  return { collidingOccurrences, timezoneTransitionsEvaluated };
}

function findFirstRelevantTimeZoneTransition(
  context: RoutineOccurrenceCountingContext
): Temporal.ZonedDateTime | null {
  const from = Temporal.Instant.fromEpochMilliseconds(
    context.fromMs
  ).toZonedDateTimeISO(context.schedule.timezone);
  const previous = from.getTimeZoneTransition("previous");
  if (previous) {
    const beforePrevious = Temporal.Instant.fromEpochNanoseconds(
      previous.epochNanoseconds - 1n
    ).toZonedDateTimeISO(context.schedule.timezone);
    const offsetDeltaNanoseconds =
      previous.offsetNanoseconds - beforePrevious.offsetNanoseconds;
    if (
      offsetDeltaNanoseconds > 0 &&
      previous.epochMilliseconds + offsetDeltaNanoseconds / 1_000_000 >=
        context.fromMs
    ) {
      return previous;
    }
  }
  return Temporal.Instant.fromEpochMilliseconds(context.fromMs - 1)
    .toZonedDateTimeISO(context.schedule.timezone)
    .getTimeZoneTransition("next");
}

function countRoutineOccurrenceCollisionsInForwardGap(input: {
  context: RoutineOccurrenceCountingContext;
  gapEnd: Temporal.PlainDateTime;
  gapStart: Temporal.PlainDateTime;
  offsetDeltaNanoseconds: number;
}): number {
  const gapStartDate = input.gapStart.toPlainDate();
  const gapEndDate = input.gapEnd.toPlainDate();
  let collidingOccurrences = 0;
  for (
    let date = gapStartDate;
    Temporal.PlainDate.compare(date, gapEndDate) <= 0;
    date = date.add({ days: 1 })
  ) {
    if (
      !routineCalendarDateMatches(input.context, {
        day: date.day,
        month: date.month - 1,
        year: date.year,
      })
    ) {
      continue;
    }
    const lowerMinute = date.equals(gapStartDate)
      ? ceilPlainDateTimeMinute(input.gapStart)
      : 0;
    const upperMinute = date.equals(gapEndDate)
      ? ceilPlainDateTimeMinute(input.gapEnd)
      : 24 * 60;
    for (const localMinute of selectedValuesInRange(
      input.context.selectedLocalMinutes,
      lowerMinute,
      upperMinute
    )) {
      const source = date.toPlainDateTime({
        hour: Math.floor(localMinute / 60),
        minute: localMinute % 60,
      });
      const destination = source.add({
        nanoseconds: input.offsetDeltaNanoseconds,
      });
      if (
        Temporal.PlainDateTime.compare(source, input.context.fromNominal) < 0 ||
        Temporal.PlainDateTime.compare(
          destination,
          input.context.throughNominal
        ) > 0 ||
        !routinePlainDateTimeMatches(input.context, destination)
      ) {
        continue;
      }
      collidingOccurrences += 1;
    }
  }
  return collidingOccurrences;
}

function routinePlainDateTimeMatches(
  context: RoutineOccurrenceCountingContext,
  value: Temporal.PlainDateTime
): boolean {
  return (
    value.second === 0 &&
    value.millisecond === 0 &&
    value.microsecond === 0 &&
    value.nanosecond === 0 &&
    routineCalendarDateMatches(context, {
      day: value.day,
      month: value.month - 1,
      year: value.year,
    }) &&
    context.selectedLocalMinutes.includes(value.hour * 60 + value.minute)
  );
}

function selectedValuesInRange(
  values: number[],
  lowerInclusive: number,
  upperExclusive: number
): number[] {
  return values.slice(
    lowerBound(values, lowerInclusive),
    lowerBound(values, upperExclusive)
  );
}

function countSortedValuesInRange(
  values: number[],
  lowerInclusive: number,
  upperExclusive: number
): number {
  return (
    lowerBound(values, upperExclusive) - lowerBound(values, lowerInclusive)
  );
}

function lowerBound(values: number[], target: number): number {
  let lower = 0;
  let upper = values.length;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if ((values[middle] ?? Number.POSITIVE_INFINITY) < target) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }
  return lower;
}

function ceilPlainDateTimeMinute(value: Temporal.PlainDateTime): number {
  const hasSubMinute =
    value.second !== 0 ||
    value.millisecond !== 0 ||
    value.microsecond !== 0 ||
    value.nanosecond !== 0;
  return value.hour * 60 + value.minute + (hasSubMinute ? 1 : 0);
}

function localDatesEqual(first: CronDate, second: CronDate): boolean {
  return (
    first.year === second.year &&
    first.month === second.month &&
    first.day === second.day
  );
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function getDayOfWeek(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month, day)).getUTCDay();
}

function getNearestWeekday(
  year: number,
  month: number,
  requestedDay: number
): number | null {
  const daysInMonth = getDaysInMonth(year, month);
  if (requestedDay > daysInMonth) {
    return null;
  }
  const dayOfWeek = getDayOfWeek(year, month, requestedDay);
  if (dayOfWeek === 0) {
    return requestedDay === daysInMonth ? requestedDay - 2 : requestedDay + 1;
  }
  if (dayOfWeek === 6) {
    return requestedDay === 1 ? requestedDay + 2 : requestedDay - 1;
  }
  return requestedDay;
}

function getLastWeekday(
  year: number,
  month: number,
  daysInMonth: number
): number {
  const dayOfWeek = getDayOfWeek(year, month, daysInMonth);
  if (dayOfWeek === 0) {
    return daysInMonth - 2;
  }
  if (dayOfWeek === 6) {
    return daysInMonth - 1;
  }
  return daysInMonth;
}

function dayBit(day: number): number {
  return 2 ** (day - 1);
}

function addDayToMask(mask: number, day: number): number {
  return dayMaskIncludes(mask, day) ? mask : mask + dayBit(day);
}

function countDaysInMask(mask: number, throughDay: number): number {
  let count = 0;
  for (let day = 1; day <= Math.min(31, throughDay); day += 1) {
    if (dayMaskIncludes(mask, day)) {
      count += 1;
    }
  }
  return count;
}

function dayMaskIncludes(mask: number, day: number): boolean {
  const bit = dayBit(day);
  return Math.floor(mask / bit) % 2 === 1;
}

function selectionIncludes(selection: number, flag: number): boolean {
  return Math.floor(selection / flag) % 2 === 1;
}

export function formatStoredRoutineSchedule(input: RoutineSchedule): string {
  const { cronExpression, timezone } = parseStoredRoutineSchedule(input);
  const [minute, hour, dayOfMonth, month, dayOfWeek] =
    cronExpression.split(" ");
  const timezoneSuffix = ` (${timezone})`;

  const minuteStep = MINUTE_STEP_PATTERN.exec(minute ?? "");
  if (
    minuteStep &&
    hour === "*" &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    const minutes = Number(minuteStep[1]);
    return `Every ${minutes} minutes${timezoneSuffix}`;
  }

  const minuteValue = parseSingleInteger(minute, 0, 59);
  const hourValue = parseSingleInteger(hour, 0, 23);
  if (minuteValue !== null && hourValue !== null && month === "*") {
    const time = formatTime(hourValue, minuteValue);
    if (dayOfMonth === "*" && dayOfWeek === "*") {
      return `Every day at ${time}${timezoneSuffix}`;
    }

    if (dayOfMonth === "*") {
      const weekday = formatSingleWeekday(dayOfWeek);
      if (weekday) {
        return `Every ${weekday} at ${time}${timezoneSuffix}`;
      }
    }

    const day = parseSingleInteger(dayOfMonth, 1, 31);
    if (day !== null && dayOfWeek === "*") {
      return `Every month on day ${day} at ${time}${timezoneSuffix}`;
    }
  }

  return `Custom recurring schedule${timezoneSuffix}`;
}

function parseStoredRoutineSchedule(
  input: RoutineSchedule
): RoutineSchedule & { cron: Cron; nominalCron: Cron } {
  const cronExpression = normalizeCronExpression(input.cronExpression);
  const timezone = normalizeTimezone(input.timezone);
  return {
    cron: createCron(cronExpression, timezone),
    cronExpression,
    nominalCron: createCron(cronExpression, "UTC"),
    timezone,
  };
}

function createCron(cronExpression: string, timezone: string): Cron {
  try {
    return new Cron(cronExpression, {
      mode: "5-part",
      paused: true,
      timezone,
    });
  } catch {
    throw invalidCronError();
  }
}

function toReferenceTime(value: Date | number): number {
  const timeMs = value instanceof Date ? value.getTime() : value;
  if (!Number.isFinite(timeMs)) {
    throw invalidReferenceTimeError();
  }
  return timeMs;
}

function assertSupportedRoutineScheduleReferenceTime(timeMs: number): void {
  if (
    timeMs < ROUTINE_SCHEDULE_RECOVERY_EARLIEST_MS ||
    timeMs > ROUTINE_SCHEDULE_RECOVERY_LATEST_MS
  ) {
    throw new RoutineScheduleValidationError(
      "routine.schedule.invalid_reference_time",
      "Routine schedule timestamps must stay inside the supported Unix-to-Croner recovery horizon."
    );
  }
}

function selectedIndexes(values: number[]): number[] {
  return values.flatMap((value, index) => (value ? [index] : []));
}

function createCronDateFromNominal(value: Temporal.PlainDateTime): CronDate {
  return new CronDate(new Date(plainDateTimeAsUtcMs(value)), 0);
}

function assertMinimumFrequency(cron: Cron): void {
  let occurrences: Date[];
  try {
    occurrences = cron.nextRuns(
      FREQUENCY_VALIDATION_OCCURRENCE_COUNT,
      FREQUENCY_VALIDATION_START
    );
  } catch {
    throw invalidCronError();
  }
  if (occurrences.length < 2) {
    throw invalidCronError();
  }

  for (let index = 1; index < occurrences.length; index += 1) {
    const previous = occurrences[index - 1];
    const current = occurrences[index];
    if (
      previous &&
      current &&
      current.getTime() - previous.getTime() < MINIMUM_ROUTINE_INTERVAL_MS
    ) {
      throw new RoutineScheduleValidationError(
        "routine.schedule.too_frequent",
        `Routine schedules must be at least ${MINIMUM_ROUTINE_INTERVAL_MINUTES} minutes apart.`
      );
    }
  }
}

function normalizeCronExpression(value: string): string {
  const normalized = String(value ?? "")
    .trim()
    .split(CRON_FIELD_SEPARATOR_PATTERN)
    .filter(Boolean)
    .join(" ");
  if (normalized.split(" ").length !== 5) {
    throw invalidCronError();
  }
  return normalized;
}

function normalizeTimezone(value: string): string {
  const timezone = String(value ?? "").trim();
  if (!(timezone === "UTC" || timezone.includes("/"))) {
    throw invalidTimezoneError();
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
  } catch {
    throw invalidTimezoneError();
  }
  return timezone;
}

function invalidCronError(): RoutineScheduleValidationError {
  return new RoutineScheduleValidationError(
    "routine.schedule.invalid_cron",
    "Cron expression must contain exactly five valid fields."
  );
}

function invalidReferenceTimeError(): RoutineScheduleValidationError {
  return new RoutineScheduleValidationError(
    "routine.schedule.invalid_reference_time",
    "Routine schedule reference time must be a valid scheduled occurrence window."
  );
}

function invalidTimezoneError(): RoutineScheduleValidationError {
  return new RoutineScheduleValidationError(
    "routine.schedule.invalid_timezone",
    "Timezone must be an explicit IANA timezone, such as America/Los_Angeles."
  );
}

function parseSingleInteger(
  value: string | undefined,
  minimum: number,
  maximum: number
): number | null {
  if (!(value && ONE_OR_TWO_DIGITS_PATTERN.test(value))) {
    return null;
  }
  const parsed = Number(value);
  return parsed >= minimum && parsed <= maximum ? parsed : null;
}

function formatTime(hour: number, minute: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${period}`;
}

function formatSingleWeekday(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const weekdays: Record<string, string> = {
    "0": "Sunday",
    "1": "Monday",
    "2": "Tuesday",
    "3": "Wednesday",
    "4": "Thursday",
    "5": "Friday",
    "6": "Saturday",
    "7": "Sunday",
    FRI: "Friday",
    MON: "Monday",
    SAT: "Saturday",
    SUN: "Sunday",
    THU: "Thursday",
    TUE: "Tuesday",
    WED: "Wednesday",
  };
  return weekdays[value.toUpperCase()] ?? null;
}
