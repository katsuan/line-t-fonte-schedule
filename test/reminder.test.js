// 予定の読みこみ・自動リマインドの送り先と時刻・LINE のカード
"use strict";
const { makeGas, planRow, plain, checkMessages } = require("./helpers");
const test = require("node:test");
const assert = require("node:assert");

const errorsOf = (messages) => checkMessages(plain(messages)).filter((p) => p.level === "error");

test("予定の読みこみ：過ぎた予定は出さず、日時の順に並べる。終了が空なら開始と同じ", () => {
  const gas = makeGas({
    now: "2026-10-23T12:00:00+09:00",
    plans: [
      planRow("2026-10-30", "19:00", "21:00", "体育館", "⚽フットサル"),
      planRow("2026-10-23", "10:00", "12:00", "公園", "朝の練習"),
      planRow("2026-10-25", "09:00", "", "グラウンド", "🏆大会"),
      ["", "", "", "", "メモだけの行"],
    ],
  });
  const records = gas.call("extractUpcomingRecordsWithDateObjects");
  assert.deepEqual(records.map((r) => r.formatted.date), ["10月25日", "10月30日"]);
  assert.equal(records[0].formatted.end, "09:00");
});

test("通知の対象：今日から RemindNum 日後まで。月末をまたいでも日付で数える", () => {
  const gas = makeGas({
    now: "2026-10-29T08:00:00+09:00",
    remindNum: "3",
    plans: [
      planRow("2026-11-01", "10:00", "12:00", "A", "練習"), // 3日後
      planRow("2026-11-02", "10:00", "12:00", "B", "練習"), // 4日後
    ],
  });
  const records = gas.call("extractUpcomingRecordsWithDateObjects");
  const targets = gas.call("getReminderTargetRecords_", records, new gas.ctx.Date());
  assert.deepEqual(targets.map((r) => r.place), ["A"]);
  assert.equal(gas.call("createAutoReminderSenderName"), "対象日: 11/1");
});

test("送信済みにした予定は、次の実行で通知しない。新しく足した予定だけ通知する", () => {
  const gas = makeGas({
    now: "2026-10-23T08:00:00+09:00",
    remindNum: "5",
    plans: [planRow("2026-10-25", "10:00", "12:00", "A", "練習")],
  });
  assert.equal(gas.call("shouldSendRemindMessage"), true);
  gas.call("completeAutoReminderSend");
  assert.equal(gas.call("shouldSendRemindMessage"), false);

  gas.plan.rows.push(planRow("2026-10-26", "10:00", "12:00", "B", "練習"));
  gas.call("forgetPlanValues_");
  gas.call("extractUpcomingRecordsWithDateObjects", true);
  const targets = gas.call("getReminderTargetRecords_", gas.call("extractUpcomingRecordsWithDateObjects"), new gas.ctx.Date());
  assert.deepEqual(targets.map((r) => r.place), ["B"]);
});

test("Setting の日数が空なら、何も通知しない（今日の予定だけを通知しない）", () => {
  const gas = makeGas({
    now: "2026-10-23T08:00:00+09:00",
    remindNum: "",
    plans: [planRow("2026-10-23", "18:00", "20:00", "A", "練習")],
  });
  assert.equal(gas.call("shouldSendRemindMessage"), false);
});

test("Setting の日数が数字でなければ、何も通知しない", () => {
  const gas = makeGas({
    now: "2026-10-23T08:00:00+09:00",
    remindNum: "あ",
    plans: [planRow("2026-10-23", "18:00", "20:00", "A", "練習")],
  });
  assert.equal(gas.call("shouldSendRemindMessage"), false);
});

test("日付またぎ：その日のうちに過ぎた予定は、朝に作った控えから出さない", () => {
  const gas = makeGas({
    now: "2026-10-23T08:00:00+09:00",
    plans: [
      planRow("2026-10-23", "10:00", "12:00", "A", "朝の練習"),
      planRow("2026-10-24", "10:00", "12:00", "B", "練習"),
    ],
  });
  assert.equal(gas.call("extractUpcomingRecordsWithDateObjects").length, 2);
  gas.setNow("2026-10-23T15:00:00+09:00");
  assert.deepEqual(gas.call("extractUpcomingRecordsWithDateObjects").map((r) => r.place), ["B"]);
});

test("日付またぎ：次の日は控えを作り直す", () => {
  const gas = makeGas({
    now: "2026-10-23T23:50:00+09:00",
    plans: [planRow("2026-10-24", "10:00", "12:00", "B", "練習")],
  });
  gas.call("extractUpcomingRecordsWithDateObjects");
  assert.equal(gas.properties.UPCOMING_RECORDS_CACHE_DATE_V1, "2026-10-23");
  gas.setNow("2026-10-24T00:10:00+09:00");
  gas.plan.rows.push(planRow("2026-10-25", "10:00", "12:00", "C", "練習"));
  gas.call("forgetPlanValues_");
  // 同じ呼び出しの中の控え（メモリ）も、日付が変われば使わない
  assert.deepEqual(gas.call("extractUpcomingRecordsWithDateObjects").map((r) => r.place), ["B", "C"]);
  assert.equal(gas.properties.UPCOMING_RECORDS_CACHE_DATE_V1, "2026-10-24");
});

test("通知の文面：直近の予定から RemindNum 日以内をまとめ、先頭のリンクを付ける", () => {
  const gas = makeGas({
    now: "2026-10-23T08:00:00+09:00",
    remindNum: "2",
    plans: [
      planRow("2026-10-24", "10:00", "12:00", "公園", "練習", "②", "https://example.com/a"),
      planRow("2026-10-26", "10:00", "12:00", "体育館", "試合"),
      planRow("2026-10-27", "10:00", "12:00", "遠く", "合宿"),
    ],
  });
  const text = gas.call("buildReminderTextMessageTextFromRecords_", gas.call("extractUpcomingRecordsWithDateObjects"));
  assert.match(text, /練習\n　10月24日 10:00-12:00\n　公園②/);
  assert.match(text, /試合/);
  assert.doesNotMatch(text, /合宿/);
  assert.match(text, /https:\/\/example\.com\/a$/);
});

test("カード：自動リマインド・#リマインド・画面用の中身は、LINE が受けつける形", () => {
  const plans = [];
  for (let i = 0; i < 20; i++) {
    const d = new Date(2026, 9, 24 + i * 3);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    plans.push(planRow(key, "10:00", i % 2 ? "" : "12:00", `場所${i}`, i % 3 ? "⚽フットサル" : "🏆大会", "", i % 4 ? "" : "https://example.com/x"));
  }
  const gas = makeGas({ now: "2026-10-23T08:00:00+09:00", plans });

  const auto = gas.call("createAutoReminderFlexMessages_");
  assert.deepEqual(errorsOf(auto), []);
  assert.equal(auto[auto.length - 1].quickReply.items.length, 4);

  const share = gas.call("createShareFlexMessages_");
  assert.deepEqual(errorsOf(share), []);

  const payload = gas.doGet({});
  assert.equal(payload.ok, true);
  assert.deepEqual(errorsOf(payload.shareMessages), []);
  // 画面用には、送信ガイドのカードを入れない
  assert.ok(payload.shareMessages[0].contents.contents.every((b) => !/送信ガイド/.test(JSON.stringify(b.header))));
});

test("カード：予定が無いときは、文字のお知らせ（LINE が受けつける形）", () => {
  const gas = makeGas({ now: "2026-10-23T08:00:00+09:00" });
  const messages = gas.call("createAutoReminderFlexMessages_");
  assert.equal(messages[0].type, "text");
  assert.deepEqual(errorsOf(messages), []);
});

test("カード：内容や場所がとても長くても、カレンダーに入れるリンクが長すぎて断られない", () => {
  const long = "とても長い場所の名前".repeat(20);
  const gas = makeGas({
    now: "2026-10-23T08:00:00+09:00",
    plans: [planRow("2026-10-24", "10:00", "12:00", long, `⚽${long}`, long)],
  });
  assert.deepEqual(errorsOf(gas.call("createShareFlexMessages_")), []);
});

test("文字のリマインド：コピーのボタンの文字は 1000 字まで", () => {
  const plans = [];
  for (let i = 0; i < 5; i++) plans.push(planRow(`2026-10-2${4 + i}`, "10:00", "12:00", "とても長い場所の名前".repeat(6), "練習".repeat(80)));
  const gas = makeGas({ now: "2026-10-23T08:00:00+09:00", plans });
  const messages = plain(gas.call("createMessage"));
  const copy = messages[0].quickReply.items.find((it) => it.action.type === "clipboard");
  assert.ok(copy.action.clipboardText.length <= 1000, `長さ ${copy.action.clipboardText.length}`);
});
