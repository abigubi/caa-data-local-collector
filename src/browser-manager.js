import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { config, paths } from "./config.js";
import { sleep } from "./util.js";

function existingExecutable() {
  const candidates = [
    config.browserExecutable,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

export class BrowserManager {
  constructor() {
    this.browser = null;
    this.context = null;
    this.process = null;
  }

  async ensure() {
    if (this.browser?.isConnected() && this.context) return this.context;
    const endpoint = `http://127.0.0.1:${config.browserDebugPort}`;
    try {
      this.browser = await chromium.connectOverCDP(endpoint);
    } catch {
      const executable = existingExecutable();
      if (!executable) throw new Error("Chrome or Edge was not found. Set browserExecutable in config.json.");
      fs.mkdirSync(paths.browserProfile, { recursive: true });
      this.process = spawn(executable, [
        `--remote-debugging-port=${config.browserDebugPort}`,
        `--user-data-dir=${paths.browserProfile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank"
      ], { detached: true, stdio: "ignore" });
      this.process.unref();
      let lastError;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await sleep(350);
        try {
          this.browser = await chromium.connectOverCDP(endpoint);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (lastError) throw new Error(`Could not connect to the local browser: ${lastError.message}`);
    }
    this.context = this.browser.contexts()[0];
    if (!this.context) throw new Error("The local browser has no usable context.");
    return this.context;
  }

  async page(label) {
    const context = await this.ensure();
    const page = await context.newPage();
    await page.setViewportSize({ width: 1365, height: 900 });
    page.__caaLabel = label;
    return page;
  }

  async openHomes() {
    const context = await this.ensure();
    const page = context.pages().find((item) => item.url() === "about:blank") ?? await context.newPage();
    await page.goto("https://www.cefconnect.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
    return { connected: true, page: page.url() };
  }

  async close() {
    await this.browser?.close().catch(() => {});
    if (this.process && !this.process.killed) this.process.kill();
    this.browser = null;
    this.context = null;
    this.process = null;
  }
}
