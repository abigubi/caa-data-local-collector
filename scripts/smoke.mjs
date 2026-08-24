import { CacheStore } from "../src/cache.js";
import { BrowserManager } from "../src/browser-manager.js";
import { Orchestrator } from "../src/orchestrator.js";

const args = process.argv.slice(2);
const source = args[args.indexOf("--source") + 1] || "cef";
const ticker = (args[args.indexOf("--ticker") + 1] || (source === "reit" ? "APLE" : "PDI")).toUpperCase();
const browserManager = new BrowserManager();
const orchestrator = new Orchestrator({ cache: new CacheStore(), browserManager });
try {
  const result = source === "reit"
    ? await orchestrator.reits({ tickers: [ticker], refresh: true })
    : await orchestrator.cef({ tickers: [ticker], refresh: true });
  console.log(JSON.stringify(result, null, 2));
  if (!result.results.length) process.exitCode = 1;
} finally {
  await browserManager.close();
}
