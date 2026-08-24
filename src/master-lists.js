import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.js";
import { normalizeTickers } from "./util.js";

const MASTER_LIST_LIMIT = 250;

export function loadMasterLists() {
  const parsed = JSON.parse(fs.readFileSync(path.join(ROOT, "master-lists.json"), "utf8"));
  const cef = normalizeTickers(parsed.cef, MASTER_LIST_LIMIT);
  const reit = normalizeTickers(parsed.reit, MASTER_LIST_LIMIT);
  if (!cef.length || !reit.length) throw new Error("master-lists.json must contain non-empty cef and reit arrays.");
  return Object.freeze({ cef: Object.freeze(cef), reit: Object.freeze(reit) });
}

export const masterLists = loadMasterLists();
