// テストの共通部分：偽物の GAS（q-oqrn の tools/qtest/fake-gas.js）に、このプロジェクトの .gs を読ませる。
// - 親プロジェクトから渡されるライブラリ（LINE_func・LoggerLib など）は、ここで小さな偽物を置く
// - いまの時刻は setNow で決められる（日付またぎ・月末のテスト用）
"use strict";
process.env.TZ = "Asia/Tokyo";

const fs = require("node:fs");
const path = require("node:path");
const { createGas, checkMessages } = require(path.join(process.env.HOME, "GitHub/q-oqrn/tools/qtest/fake-gas.js"));

const ROOT = path.join(__dirname, "..");
const SHEET_ID = "SHEET_TEST";

// GAS は .gs を名前の順に読む（02_init.gs の共通の定数を、あとのファイルが使う）
const GS_FILES = fs.readdirSync(ROOT).filter((f) => f.endsWith(".gs")).sort();

const PRELUDE = `
(function () {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(globalThis.__NOW__ !== undefined ? globalThis.__NOW__ : RealDate.now());
    }
    static now() { return globalThis.__NOW__ !== undefined ? globalThis.__NOW__ : RealDate.now(); }
  }
  globalThis.Date = FakeDate;
})();
var LINE_func = {
  createQuickReply: function (label, opt) {
    opt = opt || {};
    var action = { type: opt.type || 'message', label: label };
    if (action.type === 'uri') action.uri = opt.uri;
    else if (action.type === 'clipboard') action.clipboardText = opt.text;
    else action.text = opt.text;
    var item = { type: 'action', action: action };
    if (opt.imageUrl) item.imageUrl = opt.imageUrl;
    return item;
  }
};
var LineApiDriver = {};
var LoggerLib = {
  createLogger: function () {
    return { LEVEL: { DEBUG: 0 }, start: function () {}, finish: function () {}, debug: function () {} };
  }
};
SpreadsheetApp.openById('${SHEET_ID}').insertSheet('Plan');
(function () {
  // fake-gas の範囲には getDisplayValue（1つのセル）がないので足す
  var sheet = SpreadsheetApp.openById('${SHEET_ID}').insertSheet('Setting');
  var getRange = sheet.getRange;
  sheet.getRange = function () {
    var range = getRange.apply(sheet, arguments);
    range.getDisplayValue = function () { return String(range.getValue()); };
    return range;
  };
  sheet.getRange('B2').setValue(globalThis.__REMIND_NUM__); // qcheck-ok: G1 テストの見本
})();
`;

/** fake-gas は DeveloperMetadata を持たないので、版の読み書きに要る分だけ足す */
function addDeveloperMetadata(gas) {
  const book = gas.ctx.SpreadsheetApp.openById(SHEET_ID);
  const store = [];
  book.createDeveloperMetadataFinder = () => {
    let key = "";
    const finder = {
      withKey: (k) => ((key = k), finder),
      withLocationType: () => finder,
      find: () => store.filter((m) => m.key === key).map((m) => ({ getValue: () => m.value, setValue: (v) => { m.value = v; } })),
    };
    return finder;
  };
  book.addDeveloperMetadata = (key, value) => store.push({ key, value });
  gas.ctx.SpreadsheetApp.DeveloperMetadataLocationType = { SPREADSHEET: "SPREADSHEET" };
  gas.ctx.SpreadsheetApp.DeveloperMetadataVisibility = { DOCUMENT: "DOCUMENT" };
  gas.ctx.SpreadsheetApp.CopyPasteType = { PASTE_FORMAT: "PASTE_FORMAT" };
}

/**
 * @param {object} [o]
 *   now        … いまの時刻（"2026-10-23T10:00:00+09:00" など）
 *   remindNum  … Setting!B2（既定 5）
 *   plans      … Plan シートの行（見出しは自動で入れる）
 *   properties … Script Properties
 *   fetch      … UrlFetchApp の返事
 */
function makeGas(o = {}) {
  const now = o.now ? new Date(o.now).getTime() : undefined;
  const source = [
    `globalThis.__NOW__ = ${now === undefined ? "undefined" : now};`,
    `globalThis.__REMIND_NUM__ = ${JSON.stringify(o.remindNum === undefined ? "5" : o.remindNum)};`,
    PRELUDE,
    ...GS_FILES.map((f) => `\n// ---- ${f}\n${fs.readFileSync(path.join(ROOT, f), "utf8")}`),
  ].join("\n");

  const gas = createGas({
    source,
    properties: Object.assign({ SHEET_ID, GROUP_ID: "G_TEST" }, o.properties || {}),
    fetch: o.fetch,
    expose: ["SETTING", "SHEETS", "ACTIONS"],
  });
  gas.sheetId = SHEET_ID;
  addDeveloperMetadata(gas);

  // Plan シートに見本を入れる（seed は fake-gas の既定のブックに入れるので、ここでは Plan を直接書く）
  const plan = gas.ctx.SpreadsheetApp.openById(SHEET_ID).getSheetByName("Plan");
  plan.rows.length = 0;
  plan.rows.push(["date", "start", "end", "place", "memo1", "memo2", "link"]);
  (o.plans || []).forEach((r) => plan.rows.push([...r]));
  gas.plan = plan;
  // fake-gas の範囲には copyTo（書式のコピー）がないので、何もしないものを足す
  const getRange = plan.getRange;
  plan.getRange = (...args) => Object.assign(getRange(...args), { copyTo: () => {} });

  gas.setNow = (iso) => {
    gas.ctx.__NOW__ = new Date(iso).getTime();
  };
  return gas;
}

/** Plan シートの1行：日付・開始・終了（"HH:mm"、空なら ""）・場所・内容・補足・リンク */
function planRow(date, start, end, place, memo1, memo2 = "", link = "") {
  const [y, m, d] = date.split("-").map(Number);
  const time = (t) => {
    if (!t) return "";
    const [h, mi] = t.split(":").map(Number);
    return new Date(1899, 11, 30, h, mi);
  };
  return [new Date(y, m - 1, d), time(start), time(end), place, memo1, memo2, link];
}

/** 偽物の GAS の中の値を、テストの世界の値にする（Date などの違いをなくす） */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { makeGas, planRow, plain, checkMessages, SHEET_ID };
