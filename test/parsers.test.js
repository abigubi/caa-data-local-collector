import test from "node:test";
import assert from "node:assert/strict";
import { parseCefFundHtml, parseNavReportText, parseSeekingAlphaFfo, parseSeekingAlphaMetrics } from "../src/parsers.js";

test("parses CEF holdings and shares from the fund HTML", () => {
  const html = `<h3>Overview</h3><p>As of 8/21/2026. NAV as of 8/20/2026.</p>
    <td>Common Shares Outstanding:</td><td>475,687,260</td>
    <strong>Number of Holdings:</strong><em>As of 3/31/2026</em></td><td>1859</td>`;
  assert.deepEqual(parseCefFundHtml(html), {
    holdings: 1859,
    holdingsAsOf: "2026-03-31",
    sharesOutstanding: 475687260,
    dataAsOf: "2026-08-21"
  });
});

test("parses monthly consensus NAV text", () => {
  const parsed = parseNavReportText("REIT NAV Data as of 7/31/2026\nApple Hospitality REIT, Inc. APLE $16.67 $17.73 -5.98% Hotel Mid Cap", "report.pdf");
  assert.equal(parsed.asOf, "2026-07-31");
  assert.equal(parsed.results.APLE.consensusNav, 17.73);
});

test("parses nested Seeking Alpha estimates and metrics", () => {
  const ffo = parseSeekingAlphaFfo({ estimates: { 513836: { ffo_consensus_mean: { 2: [{ dataitemvalue: "1.58", period: { fiscalyear: 2027 } }] } } } }, [2026, 2027, 2028]);
  assert.equal(ffo[2027], 1.58);
  const metrics = parseSeekingAlphaMetrics([{ slug: "aple", div_rate_fwd: 0.96, div_distribution: 12 }], "APLE");
  assert.deepEqual(metrics, { forwardAnnualDividend: 0.96, paymentsPerYear: 12 });
});
