import { htmlText, isoDate, numberOrNull } from "./util.js";

export function parseCefFundHtml(html) {
  const plain = htmlText(html);
  const matchNumber = (pattern) => numberOrNull(plain.match(pattern)?.[1] ?? null);
  const holdingsMatch = plain.match(/Number of Holdings:\s*(?:As of\s+([0-9/.-]+)\s*)?([0-9,]+)/i);
  const sharesMatch = plain.match(/Common Shares Outstanding:\s*([0-9,]+)/i);
  const overviewAsOf = plain.match(/Overview\s+As of\s+([0-9/.-]+)/i)?.[1] ?? null;
  return {
    holdings: holdingsMatch ? numberOrNull(holdingsMatch[2]) : matchNumber(/Number of Holdings:\s*([0-9,]+)/i),
    holdingsAsOf: isoDate(holdingsMatch?.[1]),
    sharesOutstanding: sharesMatch ? numberOrNull(sharesMatch[1]) : null,
    dataAsOf: isoDate(overviewAsOf)
  };
}

export function parseNavReportText(text, sourceUrl = "") {
  const asOfRaw = text.match(/REIT NAV Data as of\s+([0-9/.-]+)/i)?.[1] ?? null;
  const asOf = isoDate(asOfRaw);
  const results = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^2MC\s*/, "").trim();
    const match = line.match(/^(.*?)\s+([A-Z][A-Z0-9.-]{0,9})\s+\$([0-9,]+(?:\.\d+)?)\s+(NA|\$[0-9,]+(?:\.\d+)?)(?:\s+(?:NA|[-+]?\d+(?:\.\d+)?%))?/);
    if (!match) continue;
    const ticker = match[2];
    results[ticker] = {
      ticker,
      name: match[1].trim(),
      sharePrice: numberOrNull(match[3]),
      consensusNav: match[4] === "NA" ? null : numberOrNull(match[4]),
      navAsOf: asOf,
      navSourceUrl: sourceUrl
    };
  }
  return { asOf, results };
}

function walk(value, visit) {
  if (!value || typeof value !== "object") return;
  visit(value);
  if (Array.isArray(value)) value.forEach((item) => walk(item, visit));
  else Object.values(value).forEach((item) => walk(item, visit));
}

function yearFromObject(object) {
  const candidates = [
    object.fiscal_year, object.fiscalYear, object.calendar_year, object.calendarYear,
    object.period_end_date, object.periodenddate, object.periodEndDate, object.fiscal_period,
    object.year, object.date, object.label
  ];
  for (const value of candidates) {
    const match = String(value ?? "").match(/\b(20\d{2})\b/);
    if (match) return Number(match[1]);
  }
  return null;
}

export function parseSeekingAlphaFfo(payload, wantedYears) {
  const output = Object.fromEntries(wantedYears.map((year) => [year, null]));
  for (const estimateSet of Object.values(payload?.estimates ?? {})) {
    for (const group of Object.values(estimateSet?.ffo_consensus_mean ?? {})) {
      for (const row of Array.isArray(group) ? group : []) {
        const year = Number(row?.period?.fiscalyear ?? row?.period?.calendaryear);
        const value = numberOrNull(row?.dataitemvalue);
        if (wantedYears.includes(year) && value !== null) output[year] = value;
      }
    }
  }
  walk(payload, (object) => {
    const merged = object.attributes && typeof object.attributes === "object"
      ? { ...object, ...object.attributes }
      : object;
    const year = yearFromObject(merged);
    if (!wantedYears.includes(year)) return;
    const key = Object.keys(merged).find((name) => /ffo.*consensus.*mean|consensus.*ffo.*mean|ffo_estimate/i.test(name));
    const value = numberOrNull(key ? merged[key] : merged.dataitemvalue);
    if (value !== null) output[year] = value;
  });
  return output;
}

export function parseSeekingAlphaMetrics(payload, ticker) {
  let candidate = null;
  walk(payload, (object) => {
    const merged = object.attributes && typeof object.attributes === "object"
      ? { ...object, ...object.attributes }
      : object;
    const slug = String(merged.slug ?? merged.ticker ?? "").toUpperCase();
    if ((!slug || slug === ticker) && ("div_rate_fwd" in merged || "div_distribution" in merged)) candidate = merged;
  });
  return {
    forwardAnnualDividend: numberOrNull(candidate?.div_rate_fwd),
    paymentsPerYear: numberOrNull(candidate?.div_distribution)
  };
}

export function distributionFrequency(payments) {
  return ({ 12: "Monthly", 4: "Quarterly", 2: "Semiannual", 1: "Annual" })[payments] ?? null;
}
