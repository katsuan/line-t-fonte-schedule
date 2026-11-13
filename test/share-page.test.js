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
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/config.js"), "utf8"), ctx);
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

test("シェア用のカード：回答リンクのピル（label つきの uri）は押せるまま。アイコンの箱の action は外す", () => {
  const app = loadApp();
  const pill = { type: "box", layout: "vertical", cornerRadius: "100px", action: { type: "uri", label: "📝 回答する", uri: "https://example.com/cup" }, contents: [{ type: "text", text: "📝 回答する" }] };
  const off = { type: "box", layout: "vertical", cornerRadius: "100px", contents: [{ type: "text", text: "回答なし" }] };
  const icon = { type: "box", layout: "vertical", action: { type: "uri", uri: "https://calendar.google.com/x" }, contents: [{ type: "text", text: "⚽" }] };
  const card = {
    type: "bubble",
    header: { type: "box", layout: "vertical", contents: [{ type: "text", text: "11月の予定" }] },
    hero: { type: "box", layout: "vertical", contents: [
      { type: "box", layout: "horizontal", contents: [icon, { type: "text", text: "大会" }] },
      { type: "box", layout: "horizontal", contents: [{ type: "text", text: "11/2(月) 🏆大会" }, pill] },
      { type: "box", layout: "horizontal", contents: [{ type: "text", text: "11/23(月) 🎉打ち上げ" }, off] },
    ] },
  };
  const sent = app.buildShareTargetPickerMessages_([{ type: "flex", altText: "予定", contents: { type: "carousel", contents: [card] } }]);
  const hero = JSON.parse(JSON.stringify(sent[0].contents.contents ? sent[0].contents.contents[0].hero : sent[0].contents.hero));
  assert.equal(hero.contents[0].contents[0].action, undefined);
  assert.deepEqual(hero.contents[1].contents[1].action, { type: "uri", label: "📝 回答する", uri: "https://example.com/cup" });
  assert.deepEqual(JSON.parse(JSON.stringify(app.extractLinkRows(card))), [
    { text: "11/2(月) 🏆大会", pill: "📝 回答する", uri: "https://example.com/cup" },
    { text: "11/23(月) 🎉打ち上げ", pill: "回答なし", uri: "" },
  ]);
  assert.equal(app.extractScheduleItemFromBox(card.hero.contents[1]), null); // 予定としては読まない
});
