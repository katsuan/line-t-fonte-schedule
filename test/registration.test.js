// チャットの #予定登録 → #予定確定、テキストの振り分け
"use strict";
const { makeGas, planRow, plain, checkMessages } = require("./helpers");
const test = require("node:test");
const assert = require("node:assert");

const event = (text, groupId = "G1", userId) => ({ type: "message", source: { type: "group", groupId, userId }, message: { type: "text", text } });

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

test("#予定登録の確認カード：下書きIDつきの登録・キャンセルのボタンを、カードとクイックリプライに置く", () => {
  const gas = makeGas({ now: "2026-10-23T08:00:00+09:00" });
  const lines = [];
  for (let i = 1; i <= 30; i++) lines.push(`11/${i} 10:00〜12:00 公園 練習`);
  const reply = plain(gas.call("handleTextMessage", event(`#予定登録\n${lines.join("\n")}\n2/30 10:00〜12:00 公園 練習`)));
  assert.equal(reply.length, 1);
  assert.deepEqual(checkMessages(reply).filter((p) => p.level === "error"), []);
  const card = JSON.stringify(reply[0].contents);
  assert.match(card, /ほか15件（登録はすべてします）/);
  assert.match(card, /読み取れなかった行/);
  assert.ok(card.length < 20000, `カードの大きさ ${card.length}`);
  const buttons = reply[0].contents.footer.contents.map((b) => b.action);
  assert.deepEqual(buttons.map((a) => a.label), ["キャンセル", "登録する"]);
  assert.match(buttons[1].text, /^#予定確定 [0-9a-z]{8}$/);
  assert.match(buttons[0].text, /^#予定キャンセル [0-9a-z]{8}$/);
  assert.deepEqual(reply[0].quickReply.items.map((it) => it.action.text), [buttons[1].text, buttons[0].text]);
});

/** #予定登録 を送り、確認カードのボタンの文字（登録する・キャンセル）を返す */
function register(gas, text, userId) {
  const reply = plain(gas.call("handleTextMessage", event(`#予定登録\n${text}`, "G1", userId)));
  const [cancel, confirm] = reply[0].contents.footer.contents.map((b) => b.action.text);
  return { confirm, cancel };
}

test("確認カードの「登録する」：2回押しても1回だけ登録し、2回目は「もう登録しています」", () => {
  const gas = makeGas({ now: "2026-10-23T08:00:00+09:00" });
  const card = register(gas, "11/2 10:00〜12:00 公園 練習", "U_A");
  assert.match(gas.call("handleTextMessage", event(card.confirm, "G1", "U_A"))[0].text, /1件登録しました/);
  assert.match(gas.call("handleTextMessage", event(card.confirm, "G1", "U_A"))[0].text, /もう登録しています/);
  assert.equal(gas.plan.rows.length, 2);
});

test("確認カードの「登録する」：何日もあとに押すと「時間がたって取り消されました」と返し、登録しない", () => {
  const gas = makeGas({ now: "2026-10-23T08:00:00+09:00" });
  const card = register(gas, "11/2 10:00〜12:00 公園 練習", "U_A");
  // 10分で登録待ちが消えたあと（CacheService の期限切れ）
  Object.keys(gas.cache).forEach((k) => delete gas.cache[k]);
  gas.setNow("2026-10-27T08:00:00+09:00");
  const reply = gas.call("handleTextMessage", event(card.confirm, "G1", "U_A"));
  assert.match(reply[0].text, /時間がたって取り消されました/);
  assert.ok(reply[0].quickReply.items.length > 0);
  assert.equal(gas.plan.rows.length, 1);
});

test("確認カードの「登録する」：ほかの人が押しても登録しない（送った人なら登録できる）", () => {
  const gas = makeGas({ now: "2026-10-23T08:00:00+09:00" });
  const card = register(gas, "11/2 10:00〜12:00 公園 練習", "U_A");
  assert.match(gas.call("handleTextMessage", event(card.confirm, "G1", "U_B"))[0].text, /送った人だけ/);
  assert.match(gas.call("handleTextMessage", event(card.cancel, "G1", "U_B"))[0].text, /送った人だけ/);
  assert.equal(gas.plan.rows.length, 1);
  assert.match(gas.call("handleTextMessage", event(card.confirm, "G1", "U_A"))[0].text, /1件登録しました/);
});

test("古い確認カードの「登録する」：新しい確認が出ていれば、古いほうでは登録しない", () => {
  const gas = makeGas({ now: "2026-10-23T08:00:00+09:00" });
  const oldCard = register(gas, "11/2 10:00〜12:00 公園 練習", "U_A");
  const newCard = register(gas, "11/3 10:00〜12:00 公園 練習", "U_A");
  assert.match(gas.call("handleTextMessage", event(oldCard.confirm, "G1", "U_A"))[0].text, /古い確認カード/);
  assert.equal(gas.plan.rows.length, 1);
  gas.call("handleTextMessage", event(newCard.confirm, "G1", "U_A"));
  assert.equal(gas.plan.rows.length, 2);
  assert.equal(gas.plan.rows[1][0].getDate(), 3);
});

test("キャンセルしたカードの「登録する」は「キャンセル済み」。手で打つ #予定確定 はこれまでどおり使える", () => {
  const gas = makeGas({ now: "2026-10-23T08:00:00+09:00" });
  const card = register(gas, "11/2 10:00〜12:00 公園 練習", "U_A");
  assert.match(gas.call("handleTextMessage", event(card.cancel, "G1", "U_A"))[0].text, /キャンセルしました/);
  assert.match(gas.call("handleTextMessage", event(card.confirm, "G1", "U_A"))[0].text, /キャンセル済み/);
  assert.match(gas.call("handleTextMessage", event(card.cancel, "G1", "U_A"))[0].text, /キャンセル済み/);
  assert.equal(gas.plan.rows.length, 1);

  register(gas, "11/4 10:00〜12:00 公園 練習", "U_A");
  assert.match(gas.call("handleTextMessage", event("#予定確定", "G1", "U_A"))[0].text, /1件登録しました/);
  assert.equal(gas.plan.rows.length, 2);
});

test("前の形の登録待ち（反映の前に保存したもの）も、手で打つ #予定確定 で登録できる", () => {
  const gas = makeGas({ now: "2026-10-23T08:00:00+09:00" });
  const ms = new Date(2026, 10, 2).getTime();
  gas.cache.SCHEDULE_PENDING_V1_G1 = JSON.stringify([{ dateMs: ms, startMs: ms + 10 * 3600e3, endMs: null, place: "公園", memo1: "練習", memo2: "", link: "" }]);
  assert.match(gas.call("handleTextMessage", event("#予定確定"))[0].text, /1件登録しました/);
  assert.equal(gas.plan.rows.length, 2);
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
