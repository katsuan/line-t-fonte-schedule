// チャットの #予定登録 → #予定確定、テキストの振り分け
"use strict";
const { makeGas, planRow, plain, checkMessages } = require("./helpers");
const test = require("node:test");
const assert = require("node:assert");

const event = (text, groupId = "G1") => ({ type: "message", source: { type: "group", groupId }, message: { type: "text", text } });

/** 同時に動いたことを確かめるための鍵：持っている間は、ほかからは取れない */
function useRealishLock(gas) {
  let held = false;
  gas.ctx.LockService.getScriptLock = () => {
    let mine = false;
    return {
      tryLock() { if (held) return false; held = mine = true; return true; },
      waitLock() { if (held) throw new Error("timeout"); held = mine = true; },
      releaseLock() { if (mine) { held = mine = false; } },
      hasLock: () => mine,
    };
  };
}

test("#予定登録：自由文と末尾のリンクを読み、確定でシートに書く", () => {
  const gas = makeGas({ now: "2026-10-23T08:00:00+09:00" });
  const reply = gas.call("handleTextMessage", event("#予定登録\n11月2日 15:00〜17:00 灘崎総合公園 フットサル（P）②\n11/3 9:00- 体育館 大会\nhttps://example.com/form"));
  assert.equal(reply[0].type, "flex");
  assert.equal(reply[0].altText, "📝 予定登録の確認：2件（11/2〜11/3）");
  assert.match(JSON.stringify(reply[0].contents), /2件を登録しますか/);
  assert.deepEqual(checkMessages(plain(reply)).filter((p) => p.level === "error"), []);

  const done = gas.call("handleTextMessage", event("#予定確定"));
  assert.match(done[0].text, /2件登録しました/);
  const rows = gas.plan.rows.slice(1);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r[3], r[4], r[5], r[6]]), [
    ["灘崎総合公園", "⚽フットサル", "②", "https://example.com/form"],
    ["体育館", "🏆大会", "", "https://example.com/form"],
  ]);
  assert.equal(rows[1][2], ""); // 終了が無い予定は、終了を空のまま
});

test("#予定登録：年をまたぐ（12月に1月の予定を入れる）と翌年になる", () => {
  const gas = makeGas({ now: "2026-12-28T08:00:00+09:00" });
  gas.call("handleTextMessage", event("#予定登録\n1/5 10:00〜12:00 公園 練習"));
  gas.call("handleTextMessage", event("#予定確定"));
  assert.equal(gas.plan.rows[1][0].getFullYear(), 2027);
});

test("#予定登録：ない日付（2/30・13/1）は、翌月にずらさず読み取れなかった行にする", () => {
  const gas = makeGas({ now: "2026-10-23T08:00:00+09:00" });
  const reply = gas.call("handleTextMessage", event("#予定登録\n2/30 10:00〜12:00 公園 練習\n13/1 10:00〜12:00 公園 練習\n11/31 10:00〜12:00 公園 練習"));
  assert.match(reply[0].text, /読み取れる予定がありませんでした/);
  assert.match(reply[0].text, /2行目/);
  assert.match(reply[0].text, /4行目/);
});

test("#予定登録：シートで式として動く文字は、文字のまま書く", () => {
  const gas = makeGas({ now: "2026-10-23T08:00:00+09:00" });
  gas.call("handleTextMessage", event('#予定登録\n11/2\t10:00\t12:00\t=HYPERLINK("https://evil.example","x")\t@練習\t-メモ\t+link'));
  gas.call("handleTextMessage", event("#予定確定"));
  assert.equal(gas.plan.rows.length, 2);
  assert.deepEqual(gas.formulaCells(), []);
});

test("#予定確定：2回続けて押しても、2回目は登録しない", () => {
  const gas = makeGas({ now: "2026-10-23T08:00:00+09:00" });
  gas.call("handleTextMessage", event("#予定登録\n11/2 10:00〜12:00 公園 練習"));
  gas.call("handleTextMessage", event("#予定確定"));
  const second = gas.call("handleTextMessage", event("#予定確定"));
  assert.match(second[0].text, /登録待ちの予定はありません/);
  assert.equal(gas.plan.rows.length, 2);
});

test("#予定確定：同時に2回動いても、1回分だけ登録する", () => {
  const gas = makeGas({ now: "2026-10-23T08:00:00+09:00" });
  useRealishLock(gas);
  gas.call("handleTextMessage", event("#予定登録\n11/2 10:00〜12:00 公園 練習"));

  // 1回目が登録待ちを読んだ直後に、2回目がはじまる
  const cache = gas.ctx.CacheService.getScriptCache();
  const get = cache.get;
  let other = null;
  cache.get = (key) => {
    const value = get(key);
    if (!other && /SCHEDULE_PENDING/.test(key)) {
      other = "running";
      other = gas.call("handleTextMessage", event("#予定確定"));
    }
    return value;
  };
  gas.call("handleTextMessage", event("#予定確定"));
  assert.ok(other, "2回目も動いた");
  assert.equal(gas.plan.rows.length, 2);
});

test("#予定登録の確認カード：登録・キャンセルはクイックリプライだけ。カードはあとで見ても通じる", () => {
  const gas = makeGas({ now: "2026-10-23T08:00:00+09:00" });
  const lines = [];
  for (let i = 1; i <= 30; i++) lines.push(`11/${i} 10:00〜12:00 公園 練習`);
  const reply = plain(gas.call("handleTextMessage", event(`#予定登録\n${lines.join("\n")}\n2/30 10:00〜12:00 公園 練習`)));
  assert.equal(reply.length, 1);
  assert.deepEqual(checkMessages(reply).filter((p) => p.level === "error"), []);
  const card = JSON.stringify(reply[0].contents);
  assert.doesNotMatch(card, /"button"|"action"/); // カードには押せるところを置かない
  assert.match(card, /ほか15件（登録はすべてします）/);
  assert.match(card, /#予定確定」と送って/);
  assert.match(card, /読み取れなかった行/);
  assert.ok(card.length < 20000, `カードの大きさ ${card.length}`);
  assert.deepEqual(reply[0].quickReply.items.map((it) => it.action.label), ["登録する", "キャンセル"]);
});

test("#予定登録：読み取れないときは、書き方の見本と、画面で入れる道を出す", () => {
  const gas = makeGas({ now: "2026-10-23T08:00:00+09:00" });
  const reply = gas.call("handleTextMessage", event("#予定登録"));
  assert.equal(reply[0].type, "text");
  assert.match(reply[0].text, /書き方/);
  assert.deepEqual(reply[0].quickReply.items.map((it) => it.action.label), ["予定を管理"]);
});

test("#予定キャンセル：登録待ちを消す", () => {
  const gas = makeGas({ now: "2026-10-23T08:00:00+09:00" });
  gas.call("handleTextMessage", event("#予定登録\n11/2 10:00〜12:00 公園 練習"));
  gas.call("handleTextMessage", event("#予定キャンセル"));
  const reply = gas.call("handleTextMessage", event("#予定確定"));
  assert.match(reply[0].text, /登録待ちの予定はありません/);
  assert.equal(gas.plan.rows.length, 1);
});

test("登録待ちは、トーク（グループ）ごとに分ける", () => {
  const gas = makeGas({ now: "2026-10-23T08:00:00+09:00" });
  gas.call("handleTextMessage", event("#予定登録\n11/2 10:00〜12:00 公園 練習", "G1"));
  const other = gas.call("handleTextMessage", event("#予定確定", "G2"));
  assert.match(other[0].text, /登録待ちの予定はありません/);
});

test("振り分け：#今後の予定・#リマインド はカード、関係ない文字には返事しない", () => {
  const gas = makeGas({ now: "2026-10-23T08:00:00+09:00", plans: [planRow("2026-10-24", "10:00", "12:00", "A", "練習")] });
  assert.equal(gas.call("handleTextMessage", event("#今後の予定"))[0].type, "flex");
  assert.equal(gas.call("handleTextMessage", event("#リマインド"))[0].type, "flex");
  assert.equal(gas.call("handleTextMessage", event("こんにちは")), undefined);
  assert.equal(gas.call("handleTextMessage", { type: "message", source: {}, message: { type: "image" } }), undefined);
});

test("振り分け：中でエラーが起きても、エラーの中身は LINE に出さない", () => {
  const gas = makeGas({ now: "2026-10-23T08:00:00+09:00", plans: [planRow("2026-10-24", "10:00", "12:00", "A", "練習")] });
  gas.ctx.SHEETS.Plan.getDataRange = () => { throw new Error("SECRET_SHEET_ID が見つかりません"); };
  const reply = gas.call("handleTextMessage", event("#予定登録\n11/2 10:00〜12:00 公園 練習"));
  assert.match(reply[0].text, /内部エラー/);
  assert.doesNotMatch(reply[0].text, /SECRET/);
});

test("DebugLog に LINE の ID をそのまま残さない", () => {
  const gas = makeGas({ now: "2026-10-23T08:00:00+09:00" });
  gas.call("handleTextMessage", { type: "message", source: { type: "user", userId: "U1234567890abcdef" }, message: { type: "text", text: "こんにちは" } });
  const log = gas.ctx.SpreadsheetApp.openById(gas.sheetId).getSheetByName("DebugLog");
  assert.ok(log.rows.length > 1);
  assert.doesNotMatch(JSON.stringify(log.rows), /U1234567890abcdef/);
});
