// GAS と同じく、.gs を名前の順に1つずつ読んでもエラーにならないこと
// （GAS はファイルごとに順に読むので、読みこみ時に、あとのファイルの関数・定数を使うとエラーになる）
"use strict";
require("./helpers");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createGas } = require(path.join(process.env.HOME, "GitHub/q-oqrn/tools/qtest/fake-gas.js"));

const ROOT = path.join(__dirname, "..");

test(".gs を名前の順に1つずつ読んでも、読みこみでエラーにならない", () => {
  const gas = createGas({
    properties: { SHEET_ID: "S" },
    source: `
      var LINE_func = { createQuickReply: function () { return {}; } };
      var LoggerLib = { createLogger: function () { return { LEVEL: {}, start: function () {}, finish: function () {}, debug: function () {} }; } };
      SpreadsheetApp.openById("S").insertSheet("Plan");
      (function () {
        var sheet = SpreadsheetApp.openById("S").insertSheet("Setting");
        var getRange = sheet.getRange;
        sheet.getRange = function () { var r = getRange.apply(sheet, arguments); r.getDisplayValue = function () { return "5"; }; return r; };
      })();`,
  });
  // clasp と GAS エディタの並び（大文字と小文字を区別しない名前の順）
  const files = fs.readdirSync(ROOT).filter((f) => f.endsWith(".gs")).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  for (const file of files) {
    assert.doesNotThrow(() => vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), gas.ctx, { filename: file }), file);
  }
});

test("どの関数の前にもコメントがあり、どのファイルの先頭にも見出しがある", () => {
  const files = fs.readdirSync(ROOT).filter((f) => f.endsWith(".gs"));
  const missing = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n");
    if (!/^\/\/ ==========\[/.test(lines[0])) missing.push(`${file}: 先頭の見出し`);
    lines.forEach((line, i) => {
      if (!/^function [\w$]+/.test(line)) return;
      let j = i - 1;
      while (j >= 0 && !lines[j].trim()) j--;
      const prev = j >= 0 ? lines[j].trim() : "";
      if (!(prev.endsWith("*/") || prev.startsWith("//"))) missing.push(`${file}: ${line}`);
    });
  }
  assert.deepEqual(missing, []);
});

test("00_ には、人が実行する関数（名前の最後に _ がない）だけを置く", () => {
  const src = fs.readFileSync(path.join(ROOT, "00_setup.gs"), "utf8");
  const names = [...src.matchAll(/^function ([\w$]+)/gm)].map((m) => m[1]);
  assert.deepEqual(names, ["runSelfCheck", "authorizeCalendarSync", "installCalendarSyncTrigger", "installPlanChangeTrigger"]);
});
