import type { Client, ClientConfig } from "pg";

export const migrationDirectory: string;
export const migrationLock: number;
export function connectionOptions(
  connectionString: string,
  local?: boolean
): ClientConfig;
export function connect(
  connectionString: string,
  local?: boolean
): Promise<Client>;
export function readMigrations(directory?: string): Promise<
  {
    name: string;
    checksum: string;
    hash: string;
    folderMillis: number;
    sql: string[];
    bps: boolean;
  }[]
>;
export function migrate(
  client: Client,
  directory?: string
): Promise<{ applied: string[]; total: number }>;
export function quoteIdentifier(value: string): string;
export function grantRuntime(client: Client, role: string): Promise<void>;
