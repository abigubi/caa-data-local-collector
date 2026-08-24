import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..");

const defaults = {
  port: 4317,
  cacheDays: 15,
  requestDelayMs: 6500,
  manualRefreshOnly: true,
  minSourceRunIntervalMinutes: 2,
  dailyTickerBudgetPerSource: 250,
  blockedSourceCooldownHours: 24,
  browserDebugPort: 9222,
  browserExecutable: "",
  estimateYears: [2026, 2027, 2028],
  secUserAgent: ""
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

export const config = Object.freeze({
  ...defaults,
  ...readJson(path.join(ROOT, "config.json"))
});

export const paths = Object.freeze({
  data: path.join(ROOT, "data"),
  cache: path.join(ROOT, "data", "cache.json"),
  browserProfile: path.join(ROOT, "data", "chromium-profile"),
  public: path.join(ROOT, "public")
});
