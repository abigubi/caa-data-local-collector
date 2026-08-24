export const DAY_MS = 24 * 60 * 60 * 1000;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeTickers(value, max = 20) {
  const values = Array.isArray(value) ? value : String(value ?? "").split(/[\s,;]+/);
  return [...new Set(values.map((item) => String(item).trim().toUpperCase())
    .filter((item) => /^[A-Z0-9.-]{1,10}$/.test(item)))].slice(0, max);
}

export function numberOrNull(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const negative = /^\s*\(.*\)\s*$/.test(value);
  const parsed = Number(value.replace(/[$,%(),]/g, "").trim());
  return Number.isFinite(parsed) ? (negative ? -parsed : parsed) : null;
}

export function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

export function htmlText(value) {
  return String(value ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function challengeDetected({ title = "", url = "", text = "" } = {}) {
  const sample = `${title} ${url} ${text}`.toLowerCase();
  return ["just a moment", "verify you are human", "access denied", "captcha", "cf-chl-", "px-captcha"]
    .some((needle) => sample.includes(needle));
}

export class ChallengeRequiredError extends Error {
  constructor(source) {
    super(`${source} needs attention in the open Chrome window. Complete any sign-in or verification, then retry.`);
    this.name = "ChallengeRequiredError";
    this.code = "BROWSER_ATTENTION_REQUIRED";
  }
}

export class SourceProtectionError extends Error {
  constructor(source, status) {
    super(`${source} returned ${status}. The collector stopped immediately and will not contact it again during the safety cooldown.`);
    this.name = "SourceProtectionError";
    this.code = "SOURCE_PROTECTION_TRIGGERED";
    this.source = source;
    this.status = status;
  }
}

export class RefreshGuardError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "RefreshGuardError";
    this.code = "REFRESH_GUARD_ACTIVE";
    Object.assign(this, details);
  }
}
