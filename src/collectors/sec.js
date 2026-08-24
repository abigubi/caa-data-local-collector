import { config } from "../config.js";
import { htmlText, isoDate, numberOrNull, sleep } from "../util.js";

let tickerMapPromise = null;

async function secJson(url) {
  const response = await fetch(url, { headers: { "User-Agent": config.secUserAgent, Accept: "application/json" } });
  if (!response.ok) throw new Error(`SEC returned ${response.status}.`);
  return response.json();
}

async function tickerMap() {
  tickerMapPromise ??= secJson("https://www.sec.gov/files/company_tickers.json").then((payload) => new Map(
    Object.values(payload).map((entry) => [String(entry.ticker).toUpperCase(), String(entry.cik_str).padStart(10, "0")])
  ));
  return tickerMapPromise;
}

function parseTaxValue(html) {
  const text = htmlText(html);
  const phrases = [...text.matchAll(/net unrealized (?:appreciation|depreciation)(?:\s*\([^)]*\))?/gi)];
  for (const phrase of phrases) {
    const start = Math.max(0, phrase.index - 400);
    const region = text.slice(start, phrase.index + 500);
    if (!/tax|federal/i.test(region)) continue;
    const tail = text.slice(phrase.index + phrase[0].length, phrase.index + phrase[0].length + 220);
    const raw = tail.match(/\(?\$?\s*([0-9][0-9,]*(?:\.\d+)?)\s*\)?/)?.[0];
    const value = numberOrNull(raw);
    if (value === null) continue;
    const negative = /depreciation/i.test(phrase[0]) || /^\s*\(/.test(raw);
    const thousands = /(?:amounts|dollars)\s+in\s+thousands|\(000s?\)|\$000/i.test(region);
    return (negative ? -Math.abs(value) : value) * (thousands ? 1000 : 1);
  }
  return null;
}

export async function collectSecTax(ticker) {
  if (!config.secUserAgent || !config.secUserAgent.includes("@")) {
    throw new Error("Set secUserAgent in config.json to a real contact before using the optional SEC lookup.");
  }
  const cik = (await tickerMap()).get(ticker);
  if (!cik) return { ticker, netUnrealizedTax: null, taxAsOf: null, secFilingUrl: null, fetchedAt: new Date().toISOString() };
  await sleep(1100);
  const submissions = await secJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const recent = submissions?.filings?.recent ?? {};
  let selected = null;
  for (let index = 0; index < (recent.form?.length ?? 0); index += 1) {
    if (!/^N-CSR(?:S)?$/i.test(recent.form[index])) continue;
    selected = {
      accession: recent.accessionNumber[index],
      document: recent.primaryDocument[index],
      period: recent.reportDate[index] ?? recent.filingDate[index]
    };
    break;
  }
  if (!selected) return { ticker, netUnrealizedTax: null, taxAsOf: null, secFilingUrl: null, fetchedAt: new Date().toISOString() };
  const accessionPath = selected.accession.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionPath}/${selected.document}`;
  await sleep(1100);
  const response = await fetch(url, { headers: { "User-Agent": config.secUserAgent, Accept: "text/html" } });
  if (!response.ok) throw new Error(`SEC filing returned ${response.status}.`);
  return {
    ticker,
    netUnrealizedTax: parseTaxValue(await response.text()),
    taxAsOf: isoDate(selected.period),
    secFilingUrl: url,
    fetchedAt: new Date().toISOString()
  };
}
