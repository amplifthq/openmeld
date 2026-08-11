import { createCanonicalSharedInMemoryDatabase } from "./shared-sqlite-fixture.ts";

type RunnerResponse = {
  stderr: string;
  status: number;
  stdout: string;
};

const EMPTY_RESPONSE: RunnerResponse = {
  status: 0,
  stdout: "",
  stderr: "",
};

const buildJsonResponse = (rows: unknown[]): RunnerResponse => {
  return {
    status: 0,
    stdout: JSON.stringify([{ results: rows, success: true }]),
    stderr: "",
  };
};

const buildJsonMultiStatementResponse = (
  resultSets: unknown[][]
): RunnerResponse => {
  return {
    status: 0,
    stdout: JSON.stringify(
      resultSets.map((rows) => ({ results: rows, success: true }))
    ),
    stderr: "",
  };
};

export const createSharedPhysicalContractRunner = () => {
  const database = createCanonicalSharedInMemoryDatabase();

  return ({ args }: { args: string[] }): RunnerResponse => {
    if (!(args.includes("execute") && args.includes("--json"))) {
      return EMPTY_RESPONSE;
    }

    const sql = args[args.indexOf("--command") + 1] ?? "";
    if (sql.trim().length === 0) {
      return EMPTY_RESPONSE;
    }

    try {
      const statements = sql
        .split(";")
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);
      if (statements.length > 1) {
        return buildJsonMultiStatementResponse(
          statements.map((statement) => database.prepare(statement).all())
        );
      }

      return buildJsonResponse(database.prepare(sql).all());
    } catch (error) {
      return {
        status: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
    }
  };
};
