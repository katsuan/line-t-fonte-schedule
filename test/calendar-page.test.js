// 公開カレンダーの画面（calendar.js・js/month-calendar.js）：次回の予定と、月の表
"use strict";
process.env.TZ = "Asia/Tokyo";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/** 何を呼んでもこわれない、画面の部品の置きもの */
function fakeElement() {
  const handler = {
    get(target, key) {
      if (key in target) return target[key];
      if (key === Symbol.toPrimitive) return () => "";
      return new Proxy(function () { return fakeElement(); }, handler);
    },
    set(target, key, value) { target[key] = value; return true; },
    apply() { return fakeElement(); },
  };
  return new Proxy(function () {}, handler);
}

/** calendar.html と同じ順に読みこむ（最初の読みこみの通信は返さない） */
function loadCalendar(now) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(now); }
    static now() { return now; }
  }
  const ctx = {
    document: { getElementById: () => fakeElement(), querySelector: () => null, querySelectorAll: () => [], createElement: () => fakeElement(), addEventListener() {} },
    window: {}, navigator: { userAgent: "test" }, location: { origin: "", pathname: "" },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: () => new Promise(() => {}), setInterval() {}, setTimeout() {}, console, Date: FakeDate, Intl,
  };
  vm.createContext(ctx);
  for (const file of ["js/month-calendar.js", "calendar.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), ctx, { filename: file });
  }
  return ctx;
}

const at = (s) => new Date(s).getTime();
const plan = (date, start, end) => ({ date, start, end, place: "公園", memo1: "練習", memo2: "", link: "" });

test("次回の予定：日をまたぐ予定（終了が開始より前）も、始まる前に飛ばさない", () => {
  const cal = loadCalendar(at("2026-10-29T21:00:00+09:00"));
  vm.runInContext(`records = ${JSON.stringify([plan("2026-10-29", "22:00", "01:00"), plan("2026-10-30", "10:00", "12:00")])};`, cal);
  assert.equal(cal.findNextRecord(at("2026-10-29T21:00:00+09:00")).date, "2026-10-29");
  // 開始の2時間後までは開催中
  assert.equal(cal.findNextRecord(at("2026-10-29T23:30:00+09:00")).date, "2026-10-29");
  assert.equal(cal.findNextRecord(at("2026-10-30T00:30:00+09:00")).date, "2026-10-30");
});

test("次回の予定：終了がない予定は、開始の2時間後まで開催中", () => {
  const cal = loadCalendar(at("2026-10-29T09:00:00+09:00"));
  vm.runInContext(`records = ${JSON.stringify([plan("2026-10-29", "10:00", ""), plan("2026-10-30", "10:00", "12:00")])};`, cal);
  assert.equal(cal.findNextRecord(at("2026-10-29T11:00:00+09:00")).date, "2026-10-29");
  assert.equal(cal.findNextRecord(at("2026-10-29T12:30:00+09:00")).date, "2026-10-30");
});

test("月の表：1日の前の空きマスは、週のはじまりに合わせる（日曜・月曜）", () => {
  const cal = loadCalendar(at("2026-10-29T09:00:00+09:00"));
  // 2026年11月1日は日曜、2027年2月1日は月曜
  assert.equal(cal.leadingBlankCount(2026, 11), 0);
  assert.equal(cal.leadingBlankCount(2027, 2), 1);
  vm.runInContext("weekStart = 1;", cal);
  assert.equal(cal.leadingBlankCount(2026, 11), 6);
  assert.equal(cal.leadingBlankCount(2027, 2), 0);
});
