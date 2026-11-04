// 画面の予定の行の部品（js/month-calendar.js）と、管理ページ（admin.js）の終了時刻の初期値
"use strict";
process.env.TZ = "Asia/Tokyo";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/** 中身を確かめられる、小さな画面の部品 */
function element(tag) {
  const el = {
    tagName: tag.toUpperCase(), className: "", textContent: "", href: "", children: [], dataset: {}, attributes: {}, style: {},
    hidden: false, disabled: false, value: "", checked: false,
    classList: { toggle() {}, add() {}, remove() {} },
    append(...items) { items.forEach((item) => el.children.push(typeof item === "string" ? { text: item } : item)); },
    appendChild(item) { el.children.push(item); return item; },
    replaceChildren(...items) { el.children = items; },
    setAttribute(key, value) { el.attributes[key] = String(value); },
    addEventListener() {}, focus() {}, showModal() {}, close() {},
  };
  return el;
}

/** ページと同じ順に読みこむ（最初の読みこみの通信は返さない） */
function loadPage(files, now) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(now); }
    static now() { return now; }
  }
  const ctx = {
    document: { getElementById: () => element("div"), querySelector: () => null, querySelectorAll: () => [], createElement: element, createTextNode: (text) => ({ text }), addEventListener() {} },
    window: {}, navigator: { userAgent: "test" }, location: { origin: "", pathname: "", href: "" },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: () => new Promise(() => {}), setInterval() {}, setTimeout() {}, clearTimeout() {}, console: { error() {}, warn() {}, log() {} },
    Date: FakeDate, Intl,
  };
  vm.createContext(ctx);
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), ctx, { filename: file });
  }
  return ctx;
}

const at = (s) => new Date(s).getTime();
const plan = (over) => Object.assign({ date: "2026-11-02", start: "10:00", end: "12:00", place: "体育館", memo1: "⚽フットサル", memo2: "", link: "" }, over);

test("行のリンク：月の共通リンクはうすいボタン、その予定だけのリンクは濃いボタン。リンクがなければカレンダー追加だけ", () => {
  const page = loadPage(["js/month-calendar.js", "calendar.js"], at("2026-11-01T09:00:00+09:00"));
  const common = "https://example.com/nov";
  const list = [plan({ link: common }), plan({ date: "2026-11-09", link: common }), plan({ date: "2026-11-16", link: "https://example.com/special" }), plan({ date: "2026-12-01" })];
  vm.runInContext(`records = ${JSON.stringify(list)};`, page);

  const linksOf = (record) => page.createRowLinks(record).children.map((a) => [a.textContent, a.className, a.href.slice(0, 30)]);
  assert.deepEqual(linksOf(list[0])[0], ["📝 回答リンク", "btn btn-small btn-answer-soft", common]);
  assert.deepEqual(linksOf(list[2])[0], ["📝 回答リンク", "btn btn-small btn-answer", "https://example.com/special"]);
  assert.deepEqual(linksOf(list[3]).map((l) => l[0]), ["📅 カレンダー追加"]);
  // 共通リンクのない月には「○月のリンクを開く」を出さない
  assert.equal(page.createMonthLinkFoot("2026-12"), null);
  assert.equal(page.createMonthLinkFoot("2026-11").children[0].textContent, "11月のリンクを開く");
});

test("カレンダー追加のリンク：日時・場所・補足を入れ、終了がなければ開始と同じ", () => {
  const page = loadPage(["js/month-calendar.js", "calendar.js"], at("2026-11-01T09:00:00+09:00"));
  const url = new URL(page.createCalendarLinkUrl(plan({ end: "", memo2: "②", memo1: "練習 & 試合" })));
  assert.equal(url.origin + url.pathname, "https://calendar.google.com/calendar/render");
  assert.equal(url.searchParams.get("text"), "練習 & 試合");
  assert.equal(url.searchParams.get("dates"), "20261102T100000/20261102T100000");
  assert.equal(url.searchParams.get("location"), "体育館");
  assert.equal(url.searchParams.get("details"), "②");
  assert.equal(url.searchParams.get("ctz"), "Asia/Tokyo");
});

test("月の共通リンク：その月でいちばん多いリンク。同じ数なら、あとに登録したもの", () => {
  const page = loadPage(["js/month-calendar.js", "calendar.js"], at("2026-11-01T09:00:00+09:00"));
  vm.runInContext(`records = ${JSON.stringify([plan({ link: "https://a.example" }), plan({ link: "https://b.example" }), plan({ date: "2026-10-30", link: "https://c.example" })])};`, page);
  assert.equal(page.baseLinkFor("2026-11"), "https://b.example");
  vm.runInContext(`records.push(${JSON.stringify(plan({ link: "https://a.example" }))});`, page);
  assert.equal(page.baseLinkFor("2026-11"), "https://a.example");
  assert.equal(page.baseLinkFor("2026-09"), "");
});

test("予定の行：過ぎた予定・選んだ予定の印、内容の先頭の絵文字はアイコンに、場所と補足は1行に", () => {
  const page = loadPage(["js/month-calendar.js", "calendar.js"], at("2026-11-03T09:00:00+09:00"));
  vm.runInContext(`records = [];`, page);
  const row = page.createRecordRow(plan({ memo2: "②" }), "2026-11-03", " is-selected", null);
  assert.equal(row.className, "row-item past is-selected");
  const [icon, body] = row.children;
  assert.equal(icon.textContent, "⚽");
  const [head, dateLine, placeLine] = body.children;
  assert.deepEqual(head.children.map((c) => c.textContent), ["フットサル", "終了"]);
  assert.deepEqual(dateLine.children.map((c) => c.text || c.textContent), ["11月2日", "(月)", " 10:00-12:00"]);
  assert.equal(placeLine.textContent, "体育館 ②");
});

test("管理ページ：終了の初期値は開始の2時間後。日をまたぐときは 23:59 まで", () => {
  const page = loadPage(["js/month-calendar.js", "admin.js"], at("2026-11-01T09:00:00+09:00"));
  assert.equal(page.defaultEndFor("10:00"), "12:00");
  assert.equal(page.defaultEndFor("9:30"), "11:30");
  assert.equal(page.defaultEndFor("22:30"), "23:59");
  assert.equal(page.defaultEndFor(""), "");
  assert.equal(page.defaultEndFor("あさ"), "");
});
