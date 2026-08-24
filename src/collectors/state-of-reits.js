import { PDFParse } from "pdf-parse";
import { challengeDetected, ChallengeRequiredError, isoDate } from "../util.js";
import { parseNavReportText } from "../parsers.js";

const MEDIA_API = "https://www.2ndmarketcapital.com/wp-json/wp/v2/media";

function dateFromUrl(url) {
  const match = url.match(/(?:^|[-_])([0-9]{1,2})[.-]([0-9]{1,2})[.-]([0-9]{4})(?:-\d+)?\.pdf/i);
  return match ? isoDate(`${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`) : null;
}

function reportScore(url) {
  if (/reit-nav-(?:premium|data)/i.test(url)) return 3;
  if (/table-10-dividend-yield-ranking/i.test(url)) return 2;
  return 0;
}

async function mediaSearch(query) {
  const url = new URL(MEDIA_API);
  url.searchParams.set("search", query);
  url.searchParams.set("per_page", "100");
  url.searchParams.set("orderby", "date");
  url.searchParams.set("order", "desc");
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`State of REITs media index returned ${response.status}.`);
  return response.json();
}

async function reportCandidates() {
  const batches = await Promise.all([mediaSearch("REIT NAV"), mediaSearch("Dividend Yield Ranking")]);
  const unique = new Map();
  for (const item of batches.flat()) {
    const url = item?.source_url;
    const asOf = dateFromUrl(url ?? "");
    const score = reportScore(url ?? "");
    if (!asOf || !score || !/\.pdf$/i.test(url)) continue;
    unique.set(url, { asOf, url, score });
  }
  return [...unique.values()].sort((a, b) => b.asOf.localeCompare(a.asOf) || b.score - a.score);
}

export async function listNavReports() {
  const reports = await reportCandidates();
  const byDate = new Map();
  for (const report of reports) if (!byDate.has(report.asOf)) byDate.set(report.asOf, report);
  return [...byDate.values()];
}

export async function collectNavReport(browserManager, requestedAsOf = null, onStatus = () => {}) {
  onStatus("Finding the monthly State of REITs NAV report...");
  const reports = await reportCandidates();
  const candidates = requestedAsOf ? reports.filter((item) => item.asOf === requestedAsOf) : reports.filter((item) => item.asOf === reports[0]?.asOf);
  if (!candidates.length) throw new Error(requestedAsOf ? `No State of REITs report was found for ${requestedAsOf}.` : "No State of REITs report link was found.");
  let lastError;
  for (const selected of candidates) {
    onStatus(`Reading consensus NAVs as of ${selected.asOf}...`);
    try {
      const response = await fetch(selected.url, { headers: { Accept: "application/pdf" } });
      if (!response.ok) throw new Error(`State of REITs PDF returned ${response.status}.`);
      const parser = new PDFParse({ data: Buffer.from(await response.arrayBuffer()) });
      try {
        const extracted = await parser.getText();
        const parsed = parseNavReportText(extracted.text, selected.url);
        if (Object.keys(parsed.results).length < 20) throw new Error("The PDF did not contain the expected consensus NAV table.");
        return { ...parsed, asOf: parsed.asOf ?? selected.asOf, sourceUrl: selected.url, fetchedAt: new Date().toISOString() };
      } finally {
        await parser.destroy();
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("No usable State of REITs consensus NAV table was found.");
}
