export function isPostgresUrl(url: string | undefined): boolean;
export function migrationsDirFor(
  env?: NodeJS.ProcessEnv,
  cwd?: string
): string;
export function migrationSqlFiles(dir: string): string[];
export function splitStatements(sql: string): string[];
export function applySqliteMigrations(dbPath: string, migrationsDir: string): void;
export function applyPostgresMigrations(
  databaseUrl: string,
  migrationsDir: string
): Promise<void>;
export function initializeSchema(
  env?: NodeJS.ProcessEnv,
  cwd?: string
): Promise<void>;
