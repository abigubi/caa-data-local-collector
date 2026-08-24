const state = { mode: "cef", excel: false, busy: false, last: null };
const el = (id) => document.getElementById(id);

const headers = {
  cef: ["Ticker", "Fund Name", "Holdings", "Latest Distribution", "Distributions / Year", "Expense Ratio", "Shares Outstanding", "1Y NAV Return", "3Y Annualized NAV", "5Y Annualized NAV", "CEF Data As Of"],
  reit: ["Ticker", "REIT Name", "2026 FFO", "2027 FFO", "2028 FFO", "Fwd Annual Dividend", "Estimate Data As Of", "Consensus NAV", "NAV As Of", "State of REITs URL"]
};

function tickers() {
  return [...new Set(el("tickers").value.toUpperCase().split(/[\s,;]+/).map((item) => item.trim()).filter((item) => /^[A-Z0-9.-]{1,10}$/.test(item)))].slice(0, 20);
}

function updateCount() { el("count").textContent = `${tickers().length} / 20`; }
function setStatus(message, kind = "") { el("status").textContent = message; el("status").className = `status ${kind}`; }
function setBusy(value) { state.busy = value; el("run").disabled = value; el("refresh-cache").disabled = value; el("open-browser").disabled = value; el("progress-bar").style.width = value ? "75%" : "0"; }
function valueOrNA(value) { return value === null || value === undefined ? "NA" : value; }

function cefRows(results, includeTax) {
  const extra = ["Tax Net Unrealized Appreciation/(Depreciation) ($000s)", "Tax Data As Of", "SEC Filing URL"];
  const outHeaders = includeTax ? [...headers.cef, ...extra] : headers.cef;
  const rows = results.map((item) => [item.ticker, item.name, valueOrNA(item.holdings), valueOrNA(item.mostRecentDistribution), valueOrNA(item.distributionsPerYear), valueOrNA(item.totalExpenseRatio), valueOrNA(item.sharesOutstanding), item.nav1Year === null ? "NA" : item.nav1Year / 100, item.nav3Year === null ? "NA" : item.nav3Year / 100, item.nav5Year === null ? "NA" : item.nav5Year / 100, valueOrNA(item.dataAsOf), ...(includeTax ? [item.netUnrealizedTax === null || item.netUnrealizedTax === undefined ? "NA" : item.netUnrealizedTax / 1000, valueOrNA(item.taxAsOf), valueOrNA(item.secFilingUrl)] : [])]);
  return { outHeaders, rows };
}

function reitRows(results) {
  return { outHeaders: headers.reit, rows: results.map((item) => [item.ticker, item.name, valueOrNA(item.ffo?.[2026]), valueOrNA(item.ffo?.[2027]), valueOrNA(item.ffo?.[2028]), valueOrNA(item.forwardAnnualDividend), valueOrNA(item.estimateDataAsOf), valueOrNA(item.consensusNav), valueOrNA(item.navAsOf), valueOrNA(item.navSourceUrl)]) };
}

function preview(result) {
  if (!result.results?.length) { el("preview").innerHTML = '<span class="error">No rows returned.</span>'; return; }
  const data = state.mode === "cef" ? cefRows(result.results, el("include-tax").checked) : reitRows(result.results);
  el("preview").innerHTML = `<table><thead><tr>${data.outHeaders.map((item) => `<th>${item}</th>`).join("")}</tr></thead><tbody>${data.rows.map((row) => `<tr>${row.map((item) => `<td>${String(item)}</td>`).join("")}</tr>`).join("")}</tbody></table>${result.errors?.length ? `<p class="warning">${result.errors.map((item) => `${item.ticker}: ${item.error}`).join("; ")}</p>` : ""}`;
}

async function writeExcel(result) {
  if (!state.excel) return;
  const data = state.mode === "cef" ? cefRows(result.results, el("include-tax").checked) : reitRows(result.results);
  const sheetName = state.mode === "cef" ? "CEF Data" : "REIT Data";
  await Excel.run(async (context) => {
    let sheet = context.workbook.worksheets.getItemOrNullObject(sheetName);
    sheet.load("isNullObject");
    await context.sync();
    if (sheet.isNullObject) sheet = context.workbook.worksheets.add(sheetName);
    else sheet.getUsedRangeOrNullObject().clear();
    const values = [data.outHeaders, ...data.rows];
    const range = sheet.getRangeByIndexes(0, 0, values.length, data.outHeaders.length);
    range.values = values;
    range.format.font.name = "Aptos";
    range.format.font.size = 10;
    range.format.autofitColumns();
    range.format.autofitRows();
    const header = sheet.getRangeByIndexes(0, 0, 1, data.outHeaders.length);
    header.format.fill.color = "#1A493F";
    header.format.font.color = "#FFFFFF";
    header.format.font.bold = true;
    if (values.length > 1) {
      if (state.mode === "cef") {
        sheet.getRangeByIndexes(1, 3, values.length - 1, 1).numberFormat = [["$0.0000"]];
        sheet.getRangeByIndexes(1, 5, values.length - 1, 1).numberFormat = [["0.00"]];
        sheet.getRangeByIndexes(1, 7, values.length - 1, 3).numberFormat = [["0.00%"]];
      } else {
        sheet.getRangeByIndexes(1, 2, values.length - 1, 3).numberFormat = [["0.00"]];
        sheet.getRangeByIndexes(1, 5, values.length - 1, 1).numberFormat = [["$0.00"]];
        sheet.getRangeByIndexes(1, 7, values.length - 1, 1).numberFormat = [["$0.00"]];
      }
      result.results.forEach((item, index) => {
        if (item.cacheStatus === "cached" || item.cacheStatus === "stale") {
          const row = sheet.getRangeByIndexes(index + 1, 0, 1, data.outHeaders.length);
          row.format.fill.color = "#FFF2CC";
          row.format.font.color = "#7F6000";
        }
      });
    }
    sheet.freezePanes.freezeRows(1);
    sheet.activate();
    range.select();
    await context.sync();
  });
}

async function run(refresh = false) {
  const list = tickers();
  if (!list.length) return setStatus("Enter at least one ticker.", "error");
  if (refresh && !globalThis.confirm(`Refresh only stale or missing ${state.mode.toUpperCase()} cache entries for ${list.length} ticker${list.length === 1 ? "" : "s"}? Source requests will stop immediately on a 403 or 429.`)) return;
  setBusy(true);
  setStatus(refresh ? `Checking the 15-day cache and refreshing only due tickers...` : `Loading ${list.length} ticker${list.length === 1 ? "" : "s"} from the local cache...`);
  try {
    const endpoint = state.mode === "cef" ? "/api/cef" : "/api/reits";
    const payload = { tickers: list, refresh, includeTax: el("include-tax").checked, navAsOf: el("nav-date").value || null };
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || `Request returned ${response.status}.`), { code: result.code });
    state.last = result;
    preview(result);
    await writeExcel(result);
    setStatus(`${result.results.length} row${result.results.length === 1 ? "" : "s"} ${state.excel ? "written to Excel" : "loaded"}.${result.errors?.length ? ` ${result.errors.length} warning(s).` : ""}`, result.errors?.length ? "warning" : "");
  } catch (error) {
    setStatus(error.message, error.code === "BROWSER_ATTENTION_REQUIRED" ? "warning" : "error");
  } finally { setBusy(false); }
}

async function readSelection() {
  await Excel.run(async (context) => {
    const range = context.workbook.getSelectedRange();
    range.load("values");
    await context.sync();
    el("tickers").value = range.values.flat().join("\n");
    updateCount();
  });
}

async function loadNavDates() {
  const select = el("nav-date");
  if (select.options.length > 1) return;
  try {
    const response = await fetch("/api/nav-dates");
    const payload = await response.json();
    (payload.dates || []).forEach((item) => select.add(new Option(item.asOf, item.asOf)));
  } catch {}
}

document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
  state.mode = button.dataset.mode;
  document.querySelectorAll("[data-mode]").forEach((item) => item.classList.toggle("active", item === button));
  el("tax-row").classList.toggle("hidden", state.mode !== "cef");
  el("nav-row").classList.toggle("hidden", state.mode !== "reit");
  el("nav-date").classList.toggle("hidden", state.mode !== "reit");
  if (state.mode === "reit") { el("tickers").value = "APLE\nO\nVICI"; loadNavDates(); }
  else el("tickers").value = "PSF\nPDI\nUTF";
  updateCount();
}));

el("tickers").addEventListener("input", updateCount);
el("run").addEventListener("click", () => run(false));
el("refresh-cache").addEventListener("click", () => run(true));
el("read-selection").addEventListener("click", () => readSelection().catch((error) => setStatus(error.message, "error")));
el("open-browser").addEventListener("click", async () => {
  setBusy(true); setStatus("Opening the dedicated Chrome profile...");
  try { const response = await fetch("/api/browser/open", { method: "POST" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error); setStatus("Chrome is ready. Complete any source sign-in there, then return here."); }
  catch (error) { setStatus(error.message, "error"); } finally { setBusy(false); }
});

if (globalThis.Office) {
  Office.onReady((info) => {
    state.excel = info.host === Office.HostType.Excel;
    el("connection").textContent = state.excel ? "Connected to Excel" : "Browser preview";
    el("read-selection").disabled = !state.excel;
  });
} else el("connection").textContent = "Browser preview";

setInterval(async () => {
  if (!state.busy) return;
  try { const response = await fetch("/api/status"); const status = await response.json(); if (status.message) setStatus(status.message, status.state === "error" ? "error" : status.state === "attention" ? "warning" : ""); } catch {}
}, 1200);

updateCount();
