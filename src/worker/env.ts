export type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
  all<T = unknown>(): Promise<{ results: T[] }>;
};

export type D1Database = {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown>;
};

export type Fetcher = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export type RoomStub = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  appendSystem(input: { event_id: string }): Promise<{
    seq: number;
    kind: "activity";
    body: string;
    actor_id: null;
    event_id: string;
    created_at: string;
  }>;
};

export type RoomNamespace = {
  getByName(name: string): RoomStub;
};

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  Room: RoomNamespace;
  ADMIN_DEV_SECRET?: string;
  POLICY_AUD?: string;
  TEAM_DOMAIN?: string;
};
