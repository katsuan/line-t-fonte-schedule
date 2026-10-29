// 予定シェアの画面（app.js）：シェア用のメッセージの作り方
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/** app.js を、画面の部品の置きもので読みこむ（起動の main は動かさない） */
function loadApp() {
  const element = () => ({ addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, appendChild() {}, textContent: "", innerHTML: "" });
  const ctx = {
    document: { getElementById: element, createElement: element, createDocumentFragment: element },
    window: {},
    localStorage: { getItem: () => null, setItem() {} },
    console,
    structuredClone,
    fetch: () => new Promise(() => {}),
  };
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8").replace(/\nmain\(\);\s*$/, "\n");
  vm.runInContext(src, ctx);
  return ctx;
}

const bubble = (title) => ({ type: "bubble", header: { type: "box", layout: "vertical", contents: [{ type: "text", text: title }] }, body: { type: "box", layout: "vertical", contents: [{ type: "text", text: "x" }] } });
const carousel = (...titles) => [{ type: "flex", altText: "予定", contents: { type: "carousel", contents: titles.map(bubble) } }];
const titlesOf = (messages) => messages[0].contents.contents.map((b) => b.header.contents[0].text);

test("シェア用のカード：先頭の送信ガイドだけを外し、月のカードは落とさない", () => {
  const app = loadApp();
  assert.deepEqual(titlesOf(app.buildShareTargetPickerMessages_(carousel("リマインド送信ガイド", "10月の予定", "11月の予定"))), ["10月の予定", "11月の予定"]);
  assert.deepEqual(titlesOf(app.buildShareTargetPickerMessages_(carousel("10月の予定", "11月の予定"))), ["10月の予定", "11月の予定"]);
  assert.deepEqual(titlesOf(app.buildShareTargetPickerMessages_(carousel("10月の予定"))), ["10月の予定"]);
});
