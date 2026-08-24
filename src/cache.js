import fs from "node:fs";
import path from "node:path";
import { config, paths } from "./config.js";
import { DAY_MS, RefreshGuardError } from "./util.js";

const EMPTY = { version: 1, cef: {}, reit: {}, navReports: {}, sec: {}, metadata: {} };

export class CacheStore {
  constructor(file = paths.cache) {
    this.file = file;
    this.data = structuredClone(EMPTY);
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      this.data = { ...structuredClone(EMPTY), ...parsed };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2));
    fs.renameSync(temporary, this.file);
  }

  get(section, key) {
    return this.data[section]?.[key] ?? null;
  }

  set(section, key, value) {
    this.data[section] ??= {};
    this.data[section][key] = value;
    this.save();
    return value;
  }

  isFresh(entry, days = config.cacheDays) {
    const stamp = Date.parse(entry?.fetchedAt ?? "");
    return Number.isFinite(stamp) && Date.now() - stamp < days * DAY_MS;
  }

  status() {
    const summarize = (section) => Object.values(this.data[section] ?? {}).map((entry) => ({
      key: entry.ticker ?? entry.asOf ?? "item",
      fetchedAt: entry.fetchedAt ?? null,
      fresh: this.isFresh(entry)
    }));
    return {
      cacheDays: config.cacheDays,
      sourceSafety: this.data.metadata?.sourceSafety ?? {},
      cef: summarize("cef"),
      reit: summarize("reit"),
      navReports: summarize("navReports")
    };
  }

  sourceState(source) {
    this.data.metadata.sourceSafety ??= {};
    this.data.metadata.sourceSafety[source] ??= { runs: [] };
    return this.data.metadata.sourceSafety[source];
  }

  beginSourceRun(source, tickers) {
    const state = this.sourceState(source);
    const now = Date.now();
    const blockedUntil = Date.parse(state.blockedUntil ?? "");
    if (Number.isFinite(blockedUntil) && blockedUntil > now) {
      throw new RefreshGuardError(`${source} is in a safety cooldown until ${state.blockedUntil}. Cached data remains available.`, { source, blockedUntil: state.blockedUntil });
    }
    const lastStarted = Date.parse(state.lastStartedAt ?? "");
    const minInterval = config.minSourceRunIntervalMinutes * 60_000;
    if (Number.isFinite(lastStarted) && now - lastStarted < minInterval) {
      const nextAt = new Date(lastStarted + minInterval).toISOString();
      throw new RefreshGuardError(`${source} was contacted recently. The next manual run is allowed after ${nextAt}.`, { source, nextAt });
    }
    state.runs = (state.runs ?? []).filter((run) => Date.parse(run.at) > now - DAY_MS);
    const used = state.runs.reduce((sum, run) => sum + Number(run.tickerCount ?? 0), 0);
    if (used + tickers.length > config.dailyTickerBudgetPerSource) {
      throw new RefreshGuardError(`${source}'s 24-hour safety budget is ${config.dailyTickerBudgetPerSource} tickers; ${used} have already been attempted.`, { source, used });
    }
    state.lastStartedAt = new Date(now).toISOString();
    state.runs.push({ at: state.lastStartedAt, tickerCount: tickers.length, tickers: [...tickers] });
    this.save();
  }

  completeSourceRun(source) {
    const state = this.sourceState(source);
    state.lastCompletedAt = new Date().toISOString();
    state.lastStatus = "ok";
    this.save();
  }

  blockSource(source, status) {
    const state = this.sourceState(source);
    state.lastStatus = status;
    state.blockedAt = new Date().toISOString();
    state.blockedUntil = new Date(Date.now() + config.blockedSourceCooldownHours * 60 * 60 * 1000).toISOString();
    this.save();
    return state.blockedUntil;
  }
}
