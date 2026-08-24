import { config } from "../config.js";
import { challengeDetected, ChallengeRequiredError, isoDate, numberOrNull, sleep, SourceProtectionError } from "../util.js";
import { parseCefFundHtml } from "../parsers.js";

const BASE = "https://www.cefconnect.com";

async function browserJson(page, url) {
  const response = await page.evaluate(async (target) => {
    const result = await fetch(target, { headers: { Accept: "application/json" }, credentials: "include" });
    return { ok: result.ok, status: result.status, text: await result.text() };
  }, url);
  if ([403, 429, 503].includes(response.status)) throw new SourceProtectionError("CEFConnect", response.status);
  if (!response.ok) throw new Error(`CEFConnect returned ${response.status} for ${new URL(url).pathname}.`);
  return JSON.parse(response.text);
}

function apiData(payload) {
  return Array.isArray(payload) ? payload : payload?.Data ?? payload?.data ?? [];
}

function cadence(frequency) {
  const value = String(frequency ?? "").toLowerCase();
  if (value.includes("monthly")) return 12;
  if (value.includes("quarter")) return 4;
  if (value.includes("semi")) return 2;
  if (value.includes("annual")) return 1;
  return null;
}

export async function collectCefConnect(browserManager, tickers, onStatus = () => {}) {
  const page = await browserManager.page("CEFConnect");
  const results = [];
  const errors = [];
  try {
    onStatus("Opening CEFConnect in local Chrome...");
    await page.goto(`${BASE}/closed-end-funds-daily-pricing`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const sample = { title: await page.title(), url: page.url(), text: (await page.locator("body").innerText().catch(() => "")).slice(0, 2500) };
    if (challengeDetected(sample)) throw new ChallengeRequiredError("CEFConnect");

    await sleep(config.requestDelayMs);
    const pricingPayload = await browserJson(page, `${BASE}/api/v3/dailypricing`);
    const pricing = apiData(pricingPayload);
    const funds = new Map(pricing.filter((fund) => fund?.Ticker).map((fund) => [String(fund.Ticker).toUpperCase(), fund]));

    for (let index = 0; index < tickers.length; index += 1) {
      const ticker = tickers[index];
      const fund = funds.get(ticker);
      if (!fund) {
        errors.push({ ticker, error: "fund not found" });
        continue;
      }
      onStatus(`CEFConnect ${index + 1}/${tickers.length}: ${ticker}`);
      await page.goto(`${BASE}/fund/${encodeURIComponent(ticker)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 2500);
      if (challengeDetected({ title: await page.title(), url: page.url(), text: bodyText })) throw new ChallengeRequiredError("CEFConnect");
      const details = parseCefFundHtml(await page.content());

      await sleep(config.requestDelayMs);
      let performance = null;
      try { performance = await browserJson(page, `${BASE}/api/v3/performance/annualized/${encodeURIComponent(ticker)}`); }
      catch (error) { if (error.code === "SOURCE_PROTECTION_TRIGGERED") throw error; }
      await sleep(config.requestDelayMs);
      let distributions = null;
      try { distributions = await browserJson(page, `${BASE}/api/v3/distributioncharter/fund/${encodeURIComponent(ticker)}/1Y`); }
      catch (error) { if (error.code === "SOURCE_PROTECTION_TRIGGERED") throw error; }

      const performanceRows = apiData(performance);
      const navReturn = (type) => numberOrNull(performanceRows.find((row) => row?.Type === type)?.NAVTR);
      const frequency = fund.DistributionFrequency ?? null;
      const cutoff = Date.now() - 366 * 24 * 60 * 60 * 1000;
      const paymentDates = new Set(apiData(distributions).flatMap((row) => {
        const time = Date.parse(row?.Date ?? "");
        return Number.isFinite(time) && time <= Date.now() && time >= cutoff ? [new Date(time).toISOString().slice(0, 10)] : [];
      }));
      const price = numberOrNull(fund.Price);
      const marketCap = numberOrNull(fund.MarketCapUSDm);
      const estimatedShares = price && marketCap ? Math.round(marketCap * 1_000_000 / price) : null;
      const fetchedAt = new Date().toISOString();
      results.push({
        ticker,
        name: fund.Name || ticker,
        holdings: details.holdings,
        holdingsStatus: details.holdings === null ? "unavailable" : "exact",
        holdingsAsOf: details.holdingsAsOf,
        mostRecentDistribution: numberOrNull(fund.CurrentDistribution) ?? numberOrNull(fund.DistributionAmtUSD),
        distributionFrequency: frequency,
        distributionsPerYear: cadence(frequency) ?? paymentDates.size,
        totalExpenseRatio: numberOrNull(fund.ExpenseRatio),
        sharesOutstanding: details.sharesOutstanding ?? estimatedShares,
        sharesOutstandingStatus: details.sharesOutstanding !== null ? "exact" : estimatedShares !== null ? "estimated" : "unavailable",
        sharesOutstandingAsOf: details.dataAsOf,
        nav1Year: navReturn("1 Year"),
        nav3Year: navReturn("3 Year"),
        nav5Year: navReturn("5 Year"),
        dataAsOf: details.dataAsOf ?? isoDate(fund.AsOfDate) ?? fetchedAt.slice(0, 10),
        dataStatus: "exact",
        sourceUrl: `${BASE}/fund/${encodeURIComponent(ticker)}`,
        fetchedAt
      });
      if (index < tickers.length - 1) await sleep(config.requestDelayMs);
    }
    return { results, errors, fetchedAt: new Date().toISOString() };
  } finally {
    if (!challengeDetected({ title: await page.title().catch(() => ""), url: page.url() })) await page.close().catch(() => {});
  }
}
