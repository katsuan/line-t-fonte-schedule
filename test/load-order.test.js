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
  const files = fs.readdirSync(ROOT).filter((f) => f.endsWith(".gs")).sort();
  for (const file of files) {
    assert.doesNotThrow(() => vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), gas.ctx, { filename: file }), file);
  }
});
