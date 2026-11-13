// 月の予定カードの回答リンク：月のボタンはいちばん多いリンク。ちがうリンク・リンクなしの予定は、その予定の箱の中にピル
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

/** 中の文字を、出てくる順に */
const textsOf = (node, out = []) => {
  if (Array.isArray(node)) node.forEach((n) => textsOf(n, out));
  else if (node && typeof node === "object") {
    if (node.type === "text" && node.text) out.push(node.text);
    Object.values(node).forEach((v) => textsOf(v, out));
  }
  return out;
};

/** 月のカードの予定の箱ごとに [内容, ピルの文字（なければ ""）] */
const pillsOf = (reply) => {
  const cards = [];
  const find = (node) => {
    if (Array.isArray(node)) node.forEach(find);
    else if (node && typeof node === "object") {
      if (node.type === "bubble" && node.hero && /月の予定/.test(textsOf(node.header).join(""))) cards.push(node);
      Object.values(node).forEach(find);
    }
  };
  find(reply);
  return cards.flatMap((card) => card.hero.contents.filter((box) => box.type === "box").map((box) => {
    const pills = [];
    const walk = (n) => {
      if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === "object") {
        if (n.type === "box" && n.cornerRadius === "100px") pills.push(textsOf(n)[0]);
        Object.values(n).forEach(walk);
      }
    };
    walk(box);
    return [textsOf(box)[1], pills[0] || ""];
  }));
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
  assert.deepEqual(pillsOf(reply), [["大会", "📝 回答する"], ["練習", ""], ["練習", ""], ["打ち上げ", "リンク別"]]); // 共通リンクの予定にはピルなし
  assert.doesNotMatch(text, /11\/2\(月\) /); // 箱の下の1行は、もう出さない
});

test("リンクがどこにもない月は、1行もピルも出さない。共通リンクだけの月も出さない", () => {
  const none = cardsFor([planRow("2026-11-02", "10:00", "12:00", "体育館", "⚽練習"), planRow("2026-11-09", "10:00", "12:00", "体育館", "⚽練習", "", "なし")]);
  assert.doesNotMatch(none.text, /回答する|リンク別/);
  const same = cardsFor([planRow("2026-11-02", "10:00", "12:00", "体育館", "⚽練習", "", COMMON), planRow("2026-11-09", "10:00", "12:00", "体育館", "⚽練習")]);
  assert.doesNotMatch(same.text, /回答する|リンク別/);
  assert.deepEqual(uris(same.reply), [["11月のリンクを開く", COMMON]]);
});

test("その日の控え（Script Properties）から読んでも、リンクなしの予定は灰色のピル。前の版（V1）の控えは消す", () => {
  const now = "2026-11-01T08:00:00+09:00";
  const plans = [
    planRow("2026-11-09", "10:00", "12:00", "体育館", "⚽練習", "", COMMON),
    planRow("2026-11-23", "18:00", "20:00", "店", "🎉打ち上げ", "", "なし"),
  ];
  const first = makeGas({ now, plans, properties: { UPCOMING_RECORDS_CACHE_MONTH_V1_2026_11: "[]" } });
  first.call("handleTextMessage", event("#今後の予定"));
  const saved = first.ctx.PropertiesService.getScriptProperties().getProperties();
  assert.equal(Object.keys(saved).some((key) => /_V1/.test(key)), false);

  // シートは同じ（月の共通リンクを決めるのに読む）で、予定は控えから読む別の呼び出し
  const second = makeGas({ now, plans, properties: saved });
  const reply = plain(second.call("handleTextMessage", event("#今後の予定")));
  assert.deepEqual(pillsOf(reply), [["練習", ""], ["打ち上げ", "リンク別"]]);
});
