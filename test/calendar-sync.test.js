// Google カレンダー同期（34_calendar_sync.gs）：シートの今日からの予定を、カレンダーに合わせる
"use strict";
const { makeGas, planRow } = require("./helpers");
const test = require("node:test");
const assert = require("node:assert");

const CALENDAR_ID = "team@group.calendar.google.com";

/** 予定を覚えるだけの、偽物のカレンダー。手で作った予定（タグなし）も置ける */
function useFakeCalendar(gas, { manual = [] } = {}) {
  const events = [];
  const add = (title, start, end, options, tags = {}) => {
    const event = {
      title, start, end, options, tags, deleted: false,
      setTag(key, value) { tags[key] = value; return event; },
      getTag(key) { return tags[key] || null; },
      deleteEvent() { event.deleted = true; },
    };
    events.push(event);
    return event;
  };
  manual.forEach((m) => add(m.title, m.start, m.end, {}));
  const calendar = {
    getEvents: (from, to) => events.filter((e) => !e.deleted && e.start < to && e.end > from),
    createEvent: (title, start, end, options) => add(title, start, end, options),
  };
  gas.ctx.CalendarApp = { getCalendarById: (id) => (id === CALENDAR_ID ? calendar : null) };
  return { live: () => events.filter((e) => !e.deleted), events };
}

const make = (plans, o = {}) => makeGas(Object.assign({ now: "2026-10-23T08:00:00+09:00", properties: { CALENDAR_ID }, plans }, o));
const hm = (d) => `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

test("カレンダー同期：今日からの予定だけを作る。終了がない・開始より前なら2時間後まで。補足とリンクは説明に", () => {
  const gas = make([
    planRow("2026-10-20", "10:00", "12:00", "公園", "過ぎた練習"),
    planRow("2026-10-23", "18:00", "20:00", "体育館", "⚽フットサル", "②", "https://example.com/oct"),
    planRow("2026-10-24", "10:00", "", "公園", "練習"),
    planRow("2026-10-25", "22:00", "01:00", "公園", "夜の練習"),
  ]);
  const cal = useFakeCalendar(gas);
  const result = gas.call("syncPlansToCalendar_", true);

  assert.deepEqual([result.ok, result.created, result.deleted, result.kept, result.failed], [true, 3, 0, 0, 0]);
  assert.deepEqual(cal.live().map((e) => [e.title, hm(e.start), hm(e.end)]), [
    ["⚽フットサル", "10/23 18:00", "10/23 20:00"],
    ["練習", "10/24 10:00", "10/24 12:00"],
    ["夜の練習", "10/25 22:00", "10/26 00:00"],
  ]);
  assert.deepEqual(cal.live()[0].options, { location: "体育館", description: "②\nhttps://example.com/oct" });
  assert.ok(cal.live().every((e) => /^[0-9a-f]{32}$/.test(e.getTag("tfonte_plan"))));
  assert.match(gas.properties.CALENDAR_SYNC_STATUS, /追加3件・削除0件・そのまま0件/);
});

test("カレンダー同期：同じ予定はそのまま。変わった予定は作り直し、シートから消えた予定は消す。手で入れた予定には触れない", () => {
  const gas = make([
    planRow("2026-10-24", "10:00", "12:00", "公園", "練習"),
    planRow("2026-10-25", "10:00", "12:00", "公園", "試合"),
  ]);
  const cal = useFakeCalendar(gas, { manual: [{ title: "手で入れた予定", start: new Date(2026, 9, 24, 9), end: new Date(2026, 9, 24, 10) }] });
  gas.call("syncPlansToCalendar_", true);

  // シートを手で直す：練習の時刻を変え、試合を消す
  gas.plan.rows.length = 1;
  gas.plan.rows.push(planRow("2026-10-24", "13:00", "15:00", "公園", "練習"));
  gas.call("forgetPlanValues_"); // 1回の呼び出しの中の読み取りの使い回しを捨てる（GAS では呼び出しごとに消える）
  const result = gas.call("syncPlansToCalendar_", true);

  assert.deepEqual([result.created, result.deleted, result.kept], [1, 2, 0]);
  assert.deepEqual(cal.live().map((e) => [e.title, hm(e.start)]), [["手で入れた予定", "10/24 09:00"], ["練習", "10/24 13:00"]]);

  const again = gas.call("syncPlansToCalendar_", true);
  assert.deepEqual([again.created, again.deleted, again.kept], [0, 0, 1]);
});

test("カレンダー同期：同じ予定が2つできていたら、1つにする", () => {
  const gas = make([planRow("2026-10-24", "10:00", "12:00", "公園", "練習")]);
  const cal = useFakeCalendar(gas);
  gas.call("syncPlansToCalendar_", true);
  const first = cal.live()[0];
  // 前の同期の途中で止まったときなど、同じ印の予定がもう1つある
  gas.ctx.CalendarApp.getCalendarById(CALENDAR_ID).createEvent(first.title, first.start, first.end, first.options).setTag("tfonte_plan", first.getTag("tfonte_plan"));

  const result = gas.call("syncPlansToCalendar_", true);
  assert.deepEqual([result.created, result.deleted, result.kept], [0, 1, 1]);
  assert.equal(cal.live().length, 1);
});

test("カレンダー同期：CALENDAR_ID がない・開けないときは何もしない。force でなく版が同じなら同期しない", () => {
  const none = make([planRow("2026-10-24", "10:00", "12:00", "公園", "練習")], { properties: {} });
  assert.deepEqual([none.call("syncPlansToCalendar_", true).skipped, none.call("syncPlansToCalendar_", true).ok], [true, false]);

  const wrong = make([planRow("2026-10-24", "10:00", "12:00", "公園", "練習")], { properties: { CALENDAR_ID: "other@group.calendar.google.com" } });
  useFakeCalendar(wrong);
  const opened = wrong.call("syncPlansToCalendar_", true);
  assert.equal(opened.ok, false);
  assert.match(opened.message, /カレンダーを開けません/);

  const gas = make([planRow("2026-10-24", "10:00", "12:00", "公園", "練習")]);
  const cal = useFakeCalendar(gas);
  gas.call("bumpPlanVersion_");
  assert.equal(gas.call("syncPlansToCalendar_", false).created, 1);
  const same = gas.call("syncPlansToCalendar_", false);
  assert.deepEqual([same.ok, same.skipped], [true, true]);
  assert.equal(cal.live().length, 1);
});

test("カレンダー同期：1件作れなくても、ほかは続けて、失敗の数を返す（版は覚えないので、次にやり直す）", () => {
  const gas = make([planRow("2026-10-24", "10:00", "12:00", "公園", "練習"), planRow("2026-10-25", "10:00", "12:00", "公園", "試合")]);
  const cal = useFakeCalendar(gas);
  const calendar = gas.ctx.CalendarApp.getCalendarById(CALENDAR_ID);
  const create = calendar.createEvent;
  calendar.createEvent = (title, ...rest) => { if (title === "練習") throw new Error("quota"); return create(title, ...rest); };
  gas.call("bumpPlanVersion_");

  const result = gas.call("syncPlansToCalendar_", false);
  assert.deepEqual([result.ok, result.created, result.failed], [false, 1, 1]);
  assert.equal(cal.live().length, 1);
  assert.equal(gas.properties.CALENDAR_SYNCED_VERSION, undefined);
});
