import { config } from "../config.js";
import { challengeDetected, ChallengeRequiredError, sleep, SourceProtectionError } from "../util.js";
import { distributionFrequency, parseSeekingAlphaFfo, parseSeekingAlphaMetrics } from "../parsers.js";

const BASE = "https://seekingalpha.com";

function waitForFfoResponse(page) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 35000);
    const listener = async (response) => {
      const url = response.url();
      if (!url.includes("/api/v3/symbol_data/estimates") || !url.includes("ffo_")) return;
      page.off("response", listener);
      clearTimeout(timeout);
      let payload = null;
      try { payload = await response.json(); } catch {}
      resolve({ payload, status: response.status(), url });
    };
    page.on("response", listener);
  });
}

async function fetchMetrics(page, ticker) {
  const params = new URLSearchParams({
    "filter[fields]": "div_rate_fwd,div_distribution",
    "filter[slugs]": ticker.toLowerCase(),
    minified: "true"
  });
  return page.evaluate(async (url) => {
    const response = await fetch(url, { headers: { Accept: "application/json" }, credentials: "include" });
    return { ok: response.ok, status: response.status, text: await response.text() };
  }, `${BASE}/api/v3/metrics?${params}`);
}

export async function collectSeekingAlpha(browserManager, tickers, onStatus = () => {}) {
  const page = await browserManager.page("Seeking Alpha");
  const results = [];
  const errors = [];
  let keepOpen = false;
  try {
    for (let index = 0; index < tickers.length; index += 1) {
      const ticker = tickers[index];
      onStatus(`Seeking Alpha ${index + 1}/${tickers.length}: ${ticker}`);
      const ffoResponse = waitForFfoResponse(page);
      await page.goto(`${BASE}/symbol/${encodeURIComponent(ticker)}/earnings/estimates`, { waitUntil: "domcontentloaded", timeout: 60000 });
      const text = (await page.locator("body").innerText().catch(() => "")).slice(0, 3500);
      if (challengeDetected({ title: await page.title(), url: page.url(), text })) {
        keepOpen = true;
        throw new ChallengeRequiredError("Seeking Alpha");
      }
      const captured = await ffoResponse;
      if (captured && [403, 429, 503].includes(captured.status)) throw new SourceProtectionError("Seeking Alpha", captured.status);
      if (!captured || captured.status >= 400 || !captured.payload) {
        errors.push({ ticker, error: `FFO response unavailable${captured ? ` (${captured.status})` : ""}` });
        continue;
      }
      await sleep(config.requestDelayMs);
      const metricsResponse = await fetchMetrics(page, ticker);
      if ([403, 429, 503].includes(metricsResponse.status)) throw new SourceProtectionError("Seeking Alpha", metricsResponse.status);
      const metricsPayload = metricsResponse.ok ? JSON.parse(metricsResponse.text) : null;
      const metrics = parseSeekingAlphaMetrics(metricsPayload, ticker);
      const ffo = parseSeekingAlphaFfo(captured.payload, config.estimateYears);
      const name = (await page.locator("h1").first().innerText().catch(() => ticker))
        .replace(new RegExp(`^${ticker}\\s*[-–—]?\\s*`, "i"), "")
        .replace(/\s+Earnings Estimates[\s\S]*$/i, "")
        .trim() || ticker;
      const tickerId = new URL(captured.url).searchParams.get("ticker_ids")?.split(",")[0] ?? null;
      const fetchedAt = new Date().toISOString();
      results.push({
        ticker,
        seekingAlphaId: tickerId,
        name,
        ffo,
        ffoStatus: Object.fromEntries(config.estimateYears.map((year) => [year, ffo[year] === null ? "unavailable" : "exact"])),
        ffoSnapshotAsOf: fetchedAt.slice(0, 10),
        estimateDataAsOf: fetchedAt.slice(0, 10),
        forwardAnnualDividend: metrics.forwardAnnualDividend,
        forwardAnnualDividendStatus: metrics.forwardAnnualDividend === null ? "unavailable" : "exact",
        dividendFrequency: distributionFrequency(metrics.paymentsPerYear),
        paymentsPerYear: metrics.paymentsPerYear,
        sourceUrl: `${BASE}/symbol/${encodeURIComponent(ticker)}`,
        fetchedAt
      });
      if (index < tickers.length - 1) await sleep(config.requestDelayMs);
    }
    return { results, errors, fetchedAt: new Date().toISOString() };
  } finally {
    if (!keepOpen) await page.close().catch(() => {});
  }
}
