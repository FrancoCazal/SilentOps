import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Proposal } from "../approval/types";
import type { IdempotencyStore } from "./idempotency";

const UNSERIALIZABLE = { unserializable: true } as const;

function readJson(path: string): unknown | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

function atomicWrite(path: string, value: unknown): void {
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(value), "utf8");
  renameSync(temporaryPath, path);
}

function normalizeValue(value: unknown): unknown {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? UNSERIALIZABLE : JSON.parse(serialized);
  } catch {
    return UNSERIALIZABLE;
  }
}

function objectEntries(value: unknown, path: string): [string, unknown][] {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError(`estado invalido en ${path}: se esperaba un objeto JSON`);
  }
  return Object.entries(value);
}

export function fileIdempotencyStore(path: string): IdempotencyStore {
  const loaded = readJson(path);
  const values = new Map<string, unknown>(
    loaded === undefined ? [] : objectEntries(loaded, path),
  );

  return {
    async seen(key) {
      return values.has(key);
    },
    async remember(key, value) {
      const normalized = normalizeValue(value);
      const next = new Map(values);
      next.set(key, normalized);
      atomicWrite(path, Object.fromEntries(next));
      values.clear();
      for (const entry of next) values.set(...entry);
    },
    async recall(key) {
      return values.get(key);
    },
  };
}

export type FileProposalStore = {
  load(): Map<string, Proposal>;
  flush(proposals: Map<string, Proposal>): Promise<void>;
  flushSync(proposals: Map<string, Proposal>): void;
};

export function fileProposalStore(path: string): FileProposalStore {
  const flushSync = (proposals: Map<string, Proposal>): void => {
    atomicWrite(path, Object.fromEntries(proposals));
  };

  return {
    load() {
      const loaded = readJson(path);
      return new Map(
        (loaded === undefined ? [] : objectEntries(loaded, path)) as [string, Proposal][],
      );
    },
    async flush(proposals) {
      flushSync(proposals);
    },
    flushSync,
  };
}

export function defaultStatePaths(): { idempotency: string; proposals: string } {
  const stateDir = process.env.LOOP_STATE_DIR ?? ".data/loop-core";
  mkdirSync(stateDir, { recursive: true });
  return {
    idempotency: join(stateDir, "idempotency.json"),
    proposals: join(stateDir, "proposals.json"),
  };
}
