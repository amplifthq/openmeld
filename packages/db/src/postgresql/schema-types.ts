import { customType } from "drizzle-orm/pg-core";

// Existing owner contracts store epoch milliseconds, including raw ledger reads.
// Keep that unit while Drizzle consumers continue to receive Date values.
export const epochMilliseconds = customType<{ data: Date; driverData: string }>(
  {
    dataType: () => "bigint",
    fromDriver: (value) => new Date(Number(value)),
    toDriver: (value) => String(value.getTime()),
  }
);

// Integer flags remain 0/1 in the relational contract. This also keeps raw
// predicates and Drizzle's boolean fields consistent during the source port.
export const integerBoolean = customType<{ data: boolean; driverData: number }>(
  {
    dataType: () => "integer",
    fromDriver: (value) => value === 1,
    toDriver: (value) => (value ? 1 : 0),
  }
);
