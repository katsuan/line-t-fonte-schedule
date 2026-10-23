// 管理ページの API（doPost）と公開カレンダーの API（doGet ?action=plans）
"use strict";
const { makeGas, planRow } = require("./helpers");
const test = require("node:test");
const assert = require("node:assert");

const ADMIN = "U_ADMIN";
const lineFetch = (userId = ADMIN) => (url) => {
  const { response } = require(require("node:path").join(process.env.HOME, "GitHub/q-oqrn/tools/qtest/fake-gas.js"));
  if (/oauth2\/v2\.1\/verify/.test(url)) {
    if (/access_token=bad/.test(url)) return response(400, { error: "invalid_request" });
    return response(200, { client_id: "2009927582", expires_in: 3600, scope: "profile openid" });
  }
  if (/v2\/profile/.test(url)) return response(200, { userId });
  return undefined;
};

const make = (o = {}) => makeGas(Object.assign({
  now: "2026-10-23T08:00:00+09:00",
  properties: { ADMIN_USER_IDS: `U_OTHER, ${ADMIN}` },
  fetch: lineFetch(o.userId),
  plans: [
    planRow("2026-10-24", "10:00", "12:00", "公園", "練習", "", "https://example.com/oct"),
    planRow("2026-11-02", "10:00", "", "体育館", "試合"),
  ],
}, o));

const record = (over = {}) => Object.assign({ date: "2026-11-05", start: "18:00", end: "20:00", place: "体育館", memo1: "練習", memo2: "", link: "" }, over);

test("本人確認：ログイン情報なし・期限切れは断る", () => {
  const gas = make();
  assert.equal(gas.doPost({ action: "list" }).code, "unauthorized");
  assert.equal(gas.doPost({ action: "list", accessToken: "bad" }).code, "unauthorized");
  assert.equal(gas.doPost("{こわれた").code, "bad_request");
});

test("権限：管理者でない人は whoami だけ。一覧も書きこみもできない", () => {
  const gas = make({ userId: "U_STRANGER" });
  const me = gas.doPost({ action: "whoami", accessToken: "t" });
  assert.deepEqual([me.ok, me.userId, me.isAdmin], [true, "U_STRANGER", false]);
  assert.equal(gas.doPost({ action: "list", accessToken: "t" }).code, "forbidden");
  assert.equal(gas.doPost({ action: "add", accessToken: "t", record: record() }).code, "forbidden");
  assert.equal(gas.plan.rows.length, 3);
});

test("管理者：一覧・追加（同じ月のリンクで補う）・編集・削除", () => {
  const gas = make();
  const list = gas.doPost({ action: "list", accessToken: "t" });
  assert.equal(list.records.length, 2);

  const added = gas.doPost({ action: "add", accessToken: "t", record: record({ date: "2026-10-30" }) });
  assert.equal(added.ok, true);
  const newRow = added.records.find((r) => r.date === "2026-10-30");
  assert.equal(newRow.link, "https://example.com/oct");

  const updated = gas.doPost({ action: "update", accessToken: "t", rowNumber: newRow.rowNumber, expected: newRow, record: record({ date: "2026-10-30", memo1: "試合" }) });
  assert.equal(updated.ok, true);
  assert.equal(gas.plan.rows[newRow.rowNumber - 1][4], "試合");

  const latest = updated.records.find((r) => r.rowNumber === newRow.rowNumber);
  const deleted = gas.doPost({ action: "delete", accessToken: "t", rowNumber: latest.rowNumber, expected: latest });
  assert.equal(deleted.ok, true);
  assert.equal(gas.plan.rows.length, 3);
});

test("管理者：画面が見ていた行とシートがちがえば、編集・削除しない", () => {
  const gas = make();
  const list = gas.doPost({ action: "list", accessToken: "t" });
  const stale = Object.assign({}, list.records[0], { memo1: "ちがう" });
  assert.equal(gas.doPost({ action: "delete", accessToken: "t", rowNumber: stale.rowNumber, expected: stale }).code, "stale");
  assert.equal(gas.doPost({ action: "delete", accessToken: "t", rowNumber: 99, expected: stale }).code, "stale");
  assert.equal(gas.plan.rows.length, 3);
});

test("管理者：入力の確かめ（ない日付・時刻・リンク）", () => {
  const gas = make();
  const bad = (over) => gas.doPost({ action: "add", accessToken: "t", record: record(over) });
  assert.equal(bad({ date: "2026-02-30" }).code, "invalid");
  assert.equal(bad({ start: "25:00" }).code, "invalid");
  assert.equal(bad({ end: "x" }).code, "invalid");
  assert.equal(bad({ link: "javascript:alert(1)" }).code, "invalid"); // qcheck-ok: W8 テストの文字
  assert.equal(bad({ memo1: "" }).code, "invalid");
  assert.equal(bad({ place: "あ".repeat(201) }).code, "invalid");
  assert.equal(bad({ link: "https://example.com/" + "a".repeat(2000) }).code, "invalid");
  assert.equal(gas.plan.rows.length, 3);
});

test("管理者：シートで式として動く文字は、文字のまま書く", () => {
  const gas = make();
  gas.doPost({ action: "add", accessToken: "t", record: record({ place: '=IMPORTXML("https://evil.example","//a")', memo1: "+1", memo2: "@x" }) });
  const preview = gas.doPost({ action: "parseSchedule", accessToken: "t", text: "11/6\t10:00\t12:00\t-場所\t=内容" });
  gas.doPost({ action: "addBatch", accessToken: "t", records: preview.records });
  assert.equal(gas.plan.rows.length, 5);
  assert.deepEqual(gas.formulaCells(), []);
  // 一覧では、元の文字のまま見える（先頭の ' はシートが隠す）
  const list = gas.doPost({ action: "list", accessToken: "t" });
  assert.ok(list.records.some((r) => r.memo1 === "'+1" || r.memo1 === "+1"));
});

test("文章でまとめて追加：確認は書きこまず、登録済みと同じ予定には印を付ける", () => {
  const gas = make();
  const preview = gas.doPost({ action: "parseSchedule", accessToken: "t", text: "10/24 10:00〜12:00 公園 練習\n11/7 10:00〜 公園 練習\n2/30 10:00〜12:00 公園 練習" });
  assert.equal(preview.ok, true);
  assert.deepEqual(preview.records.map((r) => r.duplicate), [true, false]);
  assert.equal(preview.records[1].end, "12:00");
  assert.equal(preview.errors.length, 1);
  assert.equal(preview.errors[0].lineNumber, 3);
  assert.equal(gas.plan.rows.length, 3);
});

test("文章でまとめて追加：1件でもまちがいがあれば、1件も書かない", () => {
  const gas = make();
  const res = gas.doPost({ action: "addBatch", accessToken: "t", records: [record(), record({ start: "" })] });
  assert.equal(res.code, "invalid");
  assert.match(res.message, /2件目/);
  assert.equal(gas.plan.rows.length, 3);
});

test("月の共通リンク：空の行と、これまでの共通リンクの行だけ変える", () => {
  const gas = make({
    plans: [
      planRow("2026-11-01", "10:00", "12:00", "A", "練習", "", "https://example.com/old"),
      planRow("2026-11-02", "10:00", "12:00", "B", "練習", "", ""),
      planRow("2026-11-03", "10:00", "12:00", "C", "練習", "", "https://example.com/own"),
      planRow("2026-12-01", "10:00", "12:00", "D", "練習", "", ""),
    ],
  });
  gas.doPost({ action: "setMonthLink", accessToken: "t", month: "2026-11", fromLink: "https://example.com/old", link: "https://example.com/new" });
  assert.deepEqual(gas.plan.rows.slice(1).map((r) => r[6]), ["https://example.com/new", "https://example.com/new", "https://example.com/own", ""]);
});

test("思わぬエラーの中身（設定の名前など）は、画面に返さない", () => {
  const gas = make();
  gas.ctx.SHEETS.Plan.getDataRange = () => { throw new Error("Exception: SHEET_ID 1abcSECRET にアクセスできません"); };
  const res = gas.doPost({ action: "list", accessToken: "t" });
  assert.equal(res.ok, false);
  assert.doesNotMatch(JSON.stringify(res), /SECRET/);
  // 自分で決めた言葉（ログインの期限切れなど）は、そのまま返す
  assert.match(gas.doPost({ action: "list", accessToken: "bad" }).message, /開き直して/);
});

test("公開カレンダー：今月1日からの予定を返し、エラーの中身は出さない", () => {
  const gas = make({
    plans: [
      planRow("2026-09-30", "10:00", "12:00", "先月", "練習"),
      planRow("2026-10-01", "10:00", "12:00", "今月の過ぎた日", "練習"),
      planRow("2026-11-02", "10:00", "12:00", "来月", "練習"),
    ],
  });
  const res = gas.doGet({ action: "plans" });
  assert.equal(res.ok, true);
  assert.deepEqual(res.records.map((r) => r.place), ["今月の過ぎた日", "来月"]);
  assert.equal(res.subscribeUrl, "");

  const broken = make();
  broken.ctx.SHEETS.Plan.getDataRange = () => { throw new Error("SECRET_DETAIL"); };
  const out = broken.doGet({});
  assert.equal(out.ok, false);
  assert.doesNotMatch(JSON.stringify(out), /SECRET/);
});

test("公開カレンダー：個人のカレンダー（メールアドレスの ID）なら登録リンクを出さない", () => {
  const personal = make({ properties: { ADMIN_USER_IDS: ADMIN, CALENDAR_ID: "someone@gmail.com" } });
  assert.equal(personal.doGet({ action: "plans" }).subscribeUrl, "");
  const shared = make({ properties: { ADMIN_USER_IDS: ADMIN, CALENDAR_ID: "abc@group.calendar.google.com" } });
  assert.match(shared.doGet({ action: "plans" }).subscribeUrl, /^https:\/\/calendar\.google\.com\/calendar\/u\/0\?cid=/);
});
