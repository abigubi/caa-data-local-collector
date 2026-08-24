import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { getHttpsServerOptions } from "office-addin-dev-certs";
import { config, paths, ROOT } from "./config.js";
import { CacheStore } from "./cache.js";
import { BrowserManager } from "./browser-manager.js";
import { Orchestrator } from "./orchestrator.js";
import { statusBus } from "./status.js";

const cache = new CacheStore();
const browserManager = new BrowserManager();
const orchestrator = new Orchestrator({ cache, browserManager });
const allowedOrigins = new Set([
  `https://localhost:${config.port}`,
  `https://127.0.0.1:${config.port}`,
  "https://cef-fund-scanner.keremoda.chatgpt.site"
]);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png"
};

function cors(req, res) {
  const origin = req.headers.origin;
  if (allowedOrigins.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

async function body(req) {
  let value = "";
  for await (const chunk of req) {
    value += chunk;
    if (value.length > 1_000_000) throw new Error("Request body is too large.");
  }
  return value ? JSON.parse(value) : {};
}

function staticFile(urlPath) {
  const route = urlPath === "/" || urlPath === "/excel" ? "/index.html" : urlPath;
  const resolved = path.resolve(paths.public, `.${route}`);
  return resolved.startsWith(`${path.resolve(paths.public)}${path.sep}`) ? resolved : null;
}

const handler = async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  const url = new URL(req.url, `https://${req.headers.host ?? `localhost:${config.port}`}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, version: "1.1.0", cacheDays: config.cacheDays });
    if (req.method === "GET" && url.pathname === "/api/status") return json(res, 200, statusBus.current);
    if (req.method === "GET" && url.pathname === "/api/cache/status") return json(res, 200, cache.status());
    if (req.method === "GET" && url.pathname === "/api/nav-dates") return json(res, 200, { dates: await orchestrator.navDates({ live: url.searchParams.get("live") === "1" }) });
    if (req.method === "POST" && url.pathname === "/api/browser/open") return json(res, 200, await browserManager.openHomes());
    if (req.method === "POST" && (url.pathname === "/api/cef" || url.pathname === "/api/funds")) return json(res, 200, await orchestrator.cef(await body(req)));
    if (req.method === "POST" && url.pathname === "/api/holdings") {
      const payload = await body(req);
      const result = await orchestrator.cef(payload);
      return json(res, 200, { ...result, results: result.results.map((item) => ({
        ticker: item.ticker,
        holdings: item.holdings,
        holdingsSource: item.holdingsStatus,
        holdingsAsOf: item.holdingsAsOf,
        sharesOutstanding: item.sharesOutstanding,
        sharesOutstandingSource: item.sharesOutstandingStatus,
        sharesOutstandingAsOf: item.sharesOutstandingAsOf
      })) });
    }
    if (req.method === "POST" && url.pathname === "/api/cef-tax") {
      const payload = await body(req);
      const result = await orchestrator.cef({ ...payload, includeTax: true });
      return json(res, 200, { ...result, results: result.results.map((item) => ({
        ticker: item.ticker,
        netUnrealizedTax: item.netUnrealizedTax ?? null,
        taxAsOf: item.taxAsOf ?? null,
        secFilingUrl: item.secFilingUrl ?? null
      })) });
    }
    if (req.method === "POST" && url.pathname === "/api/reits") return json(res, 200, await orchestrator.reits(await body(req)));

    if (req.method === "GET") {
      const file = staticFile(url.pathname);
      if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { "Content-Type": mime[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
        return fs.createReadStream(file).pipe(res);
      }
    }
    return json(res, 404, { error: "Not found" });
  } catch (error) {
    statusBus.update(error.message, { state: error.code === "BROWSER_ATTENTION_REQUIRED" ? "attention" : "error", code: error.code ?? null });
    return json(res, error.code === "BROWSER_ATTENTION_REQUIRED" ? 409 : 500, { error: error.message, code: error.code ?? null });
  }
};

const useHttp = process.env.CAA_LOCAL_HTTP_TEST === "1";
const server = useHttp ? http.createServer(handler) : https.createServer(await getHttpsServerOptions(), handler);
server.listen(config.port, "127.0.0.1", () => {
  console.log(`CAA Data Local Collector: ${useHttp ? "http://127.0.0.1" : "https://localhost"}:${config.port}/excel`);
  console.log(`Cache: ${path.relative(ROOT, paths.cache)} (${config.cacheDays} days)`);
  console.log("Keep this window open while using the Excel add-in.");
});

process.on("SIGINT", async () => {
  await browserManager.close();
  process.exit(0);
});
