export function migrationFiles(): { name: string; sql: string }[];
export function startEmbeddedDb(opts?: { port?: number }): Promise<{
  port: number;
  adminUrl: string;
  appUrl: string;
  authUrl: string;
  stop(): Promise<void>;
}>;
