import test from "node:test";
import assert from "node:assert/strict";
import { masterLists } from "../src/master-lists.js";

test("master lists contain the normalized unique ticker sets", () => {
  assert.equal(masterLists.cef.length, 48);
  assert.equal(masterLists.reit.length, 61);
  assert.equal(new Set(masterLists.cef).size, masterLists.cef.length);
  assert.equal(new Set(masterLists.reit).size, masterLists.reit.length);
  assert.deepEqual(masterLists.cef.slice(0, 3), ["AWF", "MCI", "HYT"]);
  assert.deepEqual(masterLists.reit.slice(-3), ["PSTL", "O", "WPC"]);
});
