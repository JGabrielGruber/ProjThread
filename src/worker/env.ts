export type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
  all<T = unknown>(): Promise<{ results: T[] }>;
};

export type D1Database = {
  prepare(query: string): D1PreparedStatement;
};

export type Fetcher = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  ADMIN_DEV_SECRET?: string;
  POLICY_AUD?: string;
  TEAM_DOMAIN?: string;
};
