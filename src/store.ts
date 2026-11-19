// Optional shared key-value store.
//
// Serverless instances do not share memory, so anything that must hold across
// instances (rate limits, single-use auth codes, failure throttles, refresh
// token records, revocation markers) goes through this interface.
//
// Backends:
//   - shared: Upstash Redis over REST. Configure with UPSTASH_REDIS_REST_URL and
//     UPSTASH_REDIS_REST_TOKEN, or the Vercel KV names KV_REST_API_URL and
//     KV_REST_API_TOKEN.
//   - memory: bounded in-process Map. Correct on one instance only.
//
// Without a shared store every feature degrades to best-effort per instance.
// Set REQUIRE_SHARED_STORE=true to make the server refuse auth requests until a
// shared store is configured.
//
// If the shared backend errors at runtime the behaviour depends on
// REQUIRE_SHARED_STORE:
//   - unset (default): the operation falls back to the memory store and the
//     failure is logged. An outage degrades protections (single-use codes, refresh
//     reuse detection and revocation are then enforced per instance only) instead
//     of taking the server down.
//   - true: the operation fails with StoreUnavailableError, which the HTTP layer
//     answers with 503 and Retry-After. Nothing falls back to memory, so a replayed
//     auth code or a revoked token family is never accepted because the store was
//     down. Choose this for shared or multi-user deployments.

import { Redis } from "@upstash/redis";

/** The shared store failed and REQUIRE_SHARED_STORE forbids degrading to memory. */
export class StoreUnavailableError extends Error {
  constructor() {
    super("The shared store is unavailable.");
    this.name = "StoreUnavailableError";
  }
}

export interface KvStore {
  readonly kind: "shared" | "memory";
  /** Atomic increment. The TTL is applied when the key is created. */
  incr(key: string, ttlMs: number): Promise<{ count: number; resetAtMs: number }>;
  decr(key: string): Promise<void>;
  /** Returns true when the key did not exist and was created (SET NX PX). */
  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  del(key: string): Promise<void>;
}

// ─── Memory ───────────────────────────────────────────────────────────────────

const MEMORY_MAX_ENTRIES = 10_000;

interface MemoryEntry {
  value: string;
  count: number;
  expiresAt: number;
}

export class MemoryStore implements KvStore {
  readonly kind = "memory" as const;
  private readonly entries = new Map<string, MemoryEntry>();
  private ops = 0;

  private live(key: string): MemoryEntry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  private sweep(): void {
    this.ops += 1;
    if (this.ops % 200 !== 0 && this.entries.size < MEMORY_MAX_ENTRIES) return;
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    while (this.entries.size >= MEMORY_MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  async incr(key: string, ttlMs: number): Promise<{ count: number; resetAtMs: number }> {
    this.sweep();
    const existing = this.live(key);
    if (existing) {
      existing.count += 1;
      return { count: existing.count, resetAtMs: existing.expiresAt };
    }
    const entry: MemoryEntry = { value: "", count: 1, expiresAt: Date.now() + ttlMs };
    this.entries.set(key, entry);
    return { count: 1, resetAtMs: entry.expiresAt };
  }

  async decr(key: string): Promise<void> {
    const existing = this.live(key);
    if (existing && existing.count > 0) existing.count -= 1;
  }

  async setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean> {
    this.sweep();
    if (this.live(key)) return false;
    this.entries.set(key, { value, count: 0, expiresAt: Date.now() + ttlMs });
    return true;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.live(key);
    if (!entry) return null;
    return entry.value !== "" ? entry.value : String(entry.count);
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    this.sweep();
    this.entries.set(key, { value, count: 0, expiresAt: Date.now() + ttlMs });
  }

  async del(key: string): Promise<void> {
    this.entries.delete(key);
  }
}

// ─── Upstash ──────────────────────────────────────────────────────────────────

class UpstashStore implements KvStore {
  readonly kind = "shared" as const;
  private readonly redis: Redis;

  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token, automaticDeserialization: false, retry: { retries: 1 } });
  }

  async incr(key: string, ttlMs: number): Promise<{ count: number; resetAtMs: number }> {
    const pipeline = this.redis.pipeline();
    pipeline.incr(key);
    pipeline.pexpire(key, ttlMs, "NX");
    pipeline.pttl(key);
    const results = (await pipeline.exec()) as [number, number, number];
    const count = Number(results[0]);
    const pttl = Number(results[2]);
    return { count, resetAtMs: Date.now() + (pttl > 0 ? pttl : ttlMs) };
  }

  async decr(key: string): Promise<void> {
    await this.redis.decr(key);
  }

  async setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(key, value, { nx: true, px: ttlMs });
    return result === "OK";
  }

  async get(key: string): Promise<string | null> {
    const value = await this.redis.get<string>(key);
    return value === null || value === undefined ? null : String(value);
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.redis.set(key, value, { px: ttlMs });
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }
}

// ─── Resilient wrapper ────────────────────────────────────────────────────────

class ResilientStore implements KvStore {
  readonly kind = "shared" as const;
  private lastErrorLogAt = 0;

  constructor(
    private readonly shared: KvStore,
    private readonly fallback: KvStore,
    private readonly onError: (op: string, err: unknown) => void,
    private readonly failClosed = false
  ) {}

  private async run<T>(op: string, fn: (s: KvStore) => Promise<T>): Promise<T> {
    try {
      return await fn(this.shared);
    } catch (err) {
      const now = Date.now();
      if (now - this.lastErrorLogAt > 30_000) {
        this.lastErrorLogAt = now;
        this.onError(op, err);
      }
      if (this.failClosed) throw new StoreUnavailableError();
      return fn(this.fallback);
    }
  }

  incr(key: string, ttlMs: number) {
    return this.run("incr", (s) => s.incr(key, ttlMs));
  }
  decr(key: string) {
    return this.run("decr", (s) => s.decr(key));
  }
  setIfAbsent(key: string, value: string, ttlMs: number) {
    return this.run("setIfAbsent", (s) => s.setIfAbsent(key, value, ttlMs));
  }
  get(key: string) {
    return this.run("get", (s) => s.get(key));
  }
  set(key: string, value: string, ttlMs: number) {
    return this.run("set", (s) => s.set(key, value, ttlMs));
  }
  del(key: string) {
    return this.run("del", (s) => s.del(key));
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function sharedStoreConfig(env: NodeJS.ProcessEnv = process.env): { url: string; token: string } | null {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

export function sharedStoreRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return ["1", "true", "yes"].includes((env.REQUIRE_SHARED_STORE ?? "").toLowerCase());
}

export function createStore(
  onError: (op: string, err: unknown) => void = () => undefined,
  env: NodeJS.ProcessEnv = process.env
): KvStore {
  const config = sharedStoreConfig(env);
  const memory = new MemoryStore();
  if (!config) return memory;
  return new ResilientStore(
    new UpstashStore(config.url, config.token),
    memory,
    onError,
    sharedStoreRequired(env)
  );
}
