// 月の予定カードの回答リンク：月のボタンはいちばん多いリンク。ちがうリンク・リンクなしの予定は1行とピル
"use strict";
const { makeGas, planRow, plain, checkMessages } = require("./helpers");
const test = require("node:test");
const assert = require("node:assert");

const event = (text) => ({ type: "message", source: { type: "group", groupId: "G1", userId: "U1" }, message: { type: "text", text } });
const COMMON = "https://example.com/nov";
const SPECIAL = "https://example.com/cup";

const cardsFor = (plans) => {
  const gas = makeGas({ now: "2026-11-01T08:00:00+09:00", plans });
  const reply = plain(gas.call("handleTextMessage", event("#今後の予定")));
  return { reply, text: JSON.stringify(reply) };
};

/** 中から、押すと開くもの（uri）を [文字, 開く先] で */
const uris = (node, out = []) => {
  if (Array.isArray(node)) node.forEach((n) => uris(n, out));
  else if (node && typeof node === "object") {
    if (node.action && node.action.type === "uri" && /example\.com/.test(node.action.uri)) out.push([node.action.label, node.action.uri]);
    Object.values(node).forEach((v) => uris(v, out));
  }
  return out;
};

test("月のボタンは、いちばん多いリンク。ちがうリンクの予定はピルで、リンクなしは灰色の押せないピル", () => {
  const { reply, text } = cardsFor([
    planRow("2026-11-02", "10:00", "12:00", "体育館", "🏆大会", "", SPECIAL), // 月のはじめが別のリンクでも
    planRow("2026-11-09", "10:00", "12:00", "体育館", "⚽練習", "", COMMON),
    planRow("2026-11-16", "10:00", "12:00", "体育館", "⚽練習", "", COMMON),
    planRow("2026-11-23", "18:00", "20:00", "店", "🎉打ち上げ", "", "なし"),
  ]);
  assert.deepEqual(checkMessages(reply).filter((p) => p.level === "error"), []);
  assert.deepEqual(uris(reply), [["📝 回答する", SPECIAL], ["11月のリンクを開く", COMMON]]);
  assert.match(text, /11\/2\(月\) 🏆大会/);
  assert.match(text, /11\/23\(月\) 🎉打ち上げ.*回答なし/);
  assert.doesNotMatch(text, /11\/9\(月\) /); // 共通リンクの予定には1行を足さない
});

test("リンクがどこにもない月は、1行もピルも出さない。共通リンクだけの月も出さない", () => {
  const none = cardsFor([planRow("2026-11-02", "10:00", "12:00", "体育館", "⚽練習"), planRow("2026-11-09", "10:00", "12:00", "体育館", "⚽練習", "", "なし")]);
  assert.doesNotMatch(none.text, /回答する|回答なし/);
  const same = cardsFor([planRow("2026-11-02", "10:00", "12:00", "体育館", "⚽練習", "", COMMON), planRow("2026-11-09", "10:00", "12:00", "体育館", "⚽練習")]);
  assert.doesNotMatch(same.text, /回答する|回答なし/);
  assert.deepEqual(uris(same.reply), [["11月のリンクを開く", COMMON]]);
});
