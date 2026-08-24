import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CacheStore } from "../src/cache.js";
import { Orchestrator } from "../src/orchestrator.js";

function temporaryCache() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "caa-data-safety-"));
  return { directory, cache: new CacheStore(path.join(directory, "cache.json")) };
}

test("source run interval and circuit breaker persist in the cache", () => {
  const { directory, cache } = temporaryCache();
  try {
    cache.beginSourceRun("CEFConnect", ["PDI"]);
    assert.throws(() => cache.beginSourceRun("CEFConnect", ["UTF"]), (error) => error.code === "REFRESH_GUARD_ACTIVE");
    const blockedUntil = cache.blockSource("CEFConnect", 429);
    const reopened = new CacheStore(path.join(directory, "cache.json"));
    assert.equal(reopened.sourceState("CEFConnect").blockedUntil, blockedUntil);
    assert.throws(() => reopened.beginSourceRun("CEFConnect", ["PSF"]), (error) => error.code === "REFRESH_GUARD_ACTIVE");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("ordinary lookup never opens a browser on cache miss", async () => {
  const { directory, cache } = temporaryCache();
  const browserManager = { page: async () => { throw new Error("browser should not open"); } };
  try {
    const result = await new Orchestrator({ cache, browserManager }).cef({ tickers: ["PDI"] });
    assert.equal(result.results.length, 0);
    assert.equal(result.errors[0].code, "CACHE_MISS");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("manual refresh does not contact a source while cache is fresh", async () => {
  const { directory, cache } = temporaryCache();
  const browserManager = { page: async () => { throw new Error("browser should not open"); } };
  try {
    cache.set("cef", "PDI", { ticker: "PDI", name: "Cached PDI", fetchedAt: new Date().toISOString(), holdings: 1, sharesOutstanding: 2 });
    const result = await new Orchestrator({ cache, browserManager }).cef({ tickers: ["PDI"], refresh: true });
    assert.equal(result.results[0].cacheStatus, "cached");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("internal master refresh can process more than the workbook limit", async () => {
  const { directory, cache } = temporaryCache();
  const browserManager = { page: async () => { throw new Error("browser should not open"); } };
  const tickers = Array.from({ length: 48 }, (_, index) => `T${index}`);
  try {
    tickers.forEach((ticker) => cache.set("cef", ticker, {
      ticker,
      name: ticker,
      fetchedAt: new Date().toISOString(),
      holdings: 1,
      sharesOutstanding: 2
    }));
    const result = await new Orchestrator({ cache, browserManager }).cef({ tickers, refresh: true }, { maxTickers: 250 });
    assert.equal(result.results.length, 48);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
