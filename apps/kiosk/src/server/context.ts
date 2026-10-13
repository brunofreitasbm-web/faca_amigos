import type { Db } from "@facaamigos/db-local";

export interface AppContext {
  db: Db;
  hmacKey: string;
  nowMs: () => number;
}
