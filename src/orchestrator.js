import { config } from "./config.js";
import { collectCefConnect } from "./collectors/cefconnect.js";
import { collectSeekingAlpha } from "./collectors/seekingalpha.js";
import { collectNavReport, listNavReports } from "./collectors/state-of-reits.js";
import { collectSecTax } from "./collectors/sec.js";
import { normalizeTickers } from "./util.js";
import { statusBus } from "./status.js";

function cachedCopy(entry, fields = {}) {
  return { ...entry, ...fields, cacheAgeDays: Math.floor((Date.now() - Date.parse(entry.fetchedAt)) / 86_400_000) };
}

export class Orchestrator {
  constructor({ cache, browserManager }) {
    this.cache = cache;
    this.browserManager = browserManager;
    this.locks = new Map();
  }

  runLocked(key, operation) {
    if (this.locks.has(key)) return this.locks.get(key);
    const promise = operation().finally(() => this.locks.delete(key));
    this.locks.set(key, promise);
    return promise;
  }

  update(message, state = "working", extra = {}) {
    statusBus.update(message, { state, ...extra });
  }

  async cef(input, { maxTickers = 20 } = {}) {
    const tickers = normalizeTickers(input.tickers, maxTickers);
    if (!tickers.length) throw new Error("Enter at least one valid ticker.");
    return this.runLocked("cef", async () => {
      const refreshRequested = input.refresh === true;
      const includeTax = Boolean(input.includeTax);
      const due = tickers.filter((ticker) => !this.cache.isFresh(this.cache.get("cef", ticker)));
      const refresh = refreshRequested ? due : [];
      const errors = [];
      if (refresh.length) {
        try {
          this.cache.beginSourceRun("CEFConnect", refresh);
          this.update(`Refreshing ${refresh.length} CEF ticker${refresh.length === 1 ? "" : "s"} in local Chrome...`);
          const live = await collectCefConnect(this.browserManager, refresh, (message) => this.update(message));
          live.results.forEach((entry) => this.cache.set("cef", entry.ticker, entry));
          errors.push(...live.errors);
          this.cache.completeSourceRun("CEFConnect");
        } catch (error) {
          if (error.code === "SOURCE_PROTECTION_TRIGGERED") this.cache.blockSource("CEFConnect", error.status);
          errors.push(...refresh.map((ticker) => ({ ticker, error: error.message, code: error.code })));
        }
      }

      const results = [];
      for (const ticker of tickers) {
        const entry = this.cache.get("cef", ticker);
        if (!entry) {
          errors.push({ ticker, error: "Not cached. Use Refresh 15-day cache now on the local add-in.", code: "CACHE_MISS" });
          continue;
        }
        const wasLive = refresh.includes(ticker) && this.cache.isFresh(entry) && !errors.some((item) => item.ticker === ticker);
        const item = wasLive ? { ...entry, cacheStatus: "live" } : cachedCopy(entry, {
          cacheStatus: this.cache.isFresh(entry) ? "cached" : "stale",
          dataStatus: "cached",
          holdingsStatus: entry.holdings === null ? "unavailable" : "cached",
          sharesOutstandingStatus: entry.sharesOutstanding === null ? "unavailable" : "cached"
        });
        if (includeTax) {
          let tax = this.cache.get("sec", ticker);
          if (refreshRequested && !this.cache.isFresh(tax)) {
            try {
              this.update(`SEC tax-basis lookup: ${ticker}`);
              tax = await collectSecTax(ticker);
              this.cache.set("sec", ticker, tax);
            } catch (error) {
              errors.push({ ticker, error: error.message, source: "SEC" });
            }
          }
          if (!tax) errors.push({ ticker, error: "SEC value is not cached. Include it during the next manual refresh.", source: "SEC", code: "CACHE_MISS" });
          Object.assign(item, tax ?? { netUnrealizedTax: null, taxAsOf: null, secFilingUrl: null });
        }
        results.push(item);
      }
      this.update(`CEF lookup complete: ${results.length}/${tickers.length} returned.`, "idle");
      return { results, errors, fetchedAt: new Date().toISOString(), cacheDays: config.cacheDays };
    });
  }

  async navReport(requestedAsOf, refreshRequested) {
    if (requestedAsOf) {
      const cached = this.cache.get("navReports", requestedAsOf);
      if (cached) return cached;
      if (!refreshRequested) return null;
    } else {
      const latest = Object.values(this.cache.data.navReports ?? {}).sort((a, b) => String(b.asOf).localeCompare(String(a.asOf)))[0];
      if (!refreshRequested && latest) return latest;
      if (refreshRequested && this.cache.isFresh(latest)) return latest;
      if (!refreshRequested) return null;
    }
    const report = await collectNavReport(this.browserManager, requestedAsOf, (message) => this.update(message));
    this.cache.set("navReports", report.asOf, report);
    return report;
  }

  async reits(input, { maxTickers = 20 } = {}) {
    const tickers = normalizeTickers(input.tickers, maxTickers);
    if (!tickers.length) throw new Error("Enter at least one valid ticker.");
    return this.runLocked("reit", async () => {
      const refreshRequested = input.refresh === true;
      const errors = [];
      let nav = null;
      try {
        nav = await this.navReport(input.navAsOf || null, refreshRequested);
      } catch (error) {
        errors.push({ ticker: "Consensus NAV", error: error.message });
      }

      const due = tickers.filter((ticker) => !this.cache.isFresh(this.cache.get("reit", ticker)));
      const refresh = refreshRequested ? due : [];
      if (refresh.length) {
        try {
          this.cache.beginSourceRun("Seeking Alpha", refresh);
          this.update(`Refreshing ${refresh.length} REIT ticker${refresh.length === 1 ? "" : "s"} in local Chrome...`);
          const live = await collectSeekingAlpha(this.browserManager, refresh, (message) => this.update(message));
          live.results.forEach((entry) => this.cache.set("reit", entry.ticker, entry));
          errors.push(...live.errors);
          this.cache.completeSourceRun("Seeking Alpha");
        } catch (error) {
          if (error.code === "SOURCE_PROTECTION_TRIGGERED") this.cache.blockSource("Seeking Alpha", error.status);
          errors.push(...refresh.map((ticker) => ({ ticker, error: error.message, code: error.code })));
        }
      }

      const results = tickers.flatMap((ticker) => {
        const entry = this.cache.get("reit", ticker);
        if (!entry) {
          errors.push({ ticker, error: "Not cached. Use Refresh 15-day cache now on the local add-in.", code: "CACHE_MISS" });
          return [];
        }
        const wasLive = refresh.includes(ticker) && !errors.some((item) => item.ticker === ticker);
        const base = wasLive ? { ...entry, cacheStatus: "live" } : cachedCopy(entry, {
          cacheStatus: this.cache.isFresh(entry) ? "cached" : "stale",
          ffoStatus: Object.fromEntries(config.estimateYears.map((year) => [year, entry.ffo?.[year] === null ? "unavailable" : "cached"])),
          forwardAnnualDividendStatus: entry.forwardAnnualDividend === null ? "unavailable" : "cached"
        });
        const navEntry = nav?.results?.[ticker];
        return [{
          ...base,
          consensusNav: navEntry?.consensusNav ?? null,
          consensusNavStatus: navEntry?.consensusNav === null || navEntry === undefined ? "unavailable" : "exact",
          navAsOf: navEntry?.navAsOf ?? nav?.asOf ?? null,
          navSourceUrl: navEntry?.navSourceUrl ?? nav?.sourceUrl ?? null
        }];
      });
      this.update(`REIT lookup complete: ${results.length}/${tickers.length} returned.`, "idle");
      return { results, errors, fetchedAt: new Date().toISOString(), cacheDays: config.cacheDays, estimateYears: config.estimateYears };
    });
  }

  async navDates({ live = false } = {}) {
    const cached = Object.values(this.cache.data.navReports ?? {}).map((entry) => ({ asOf: entry.asOf, url: entry.sourceUrl }));
    if (!live && cached.length) return cached.sort((a, b) => b.asOf.localeCompare(a.asOf));
    try {
      return await listNavReports(this.browserManager);
    } catch {
      return cached.sort((a, b) => b.asOf.localeCompare(a.asOf));
    }
  }
}
