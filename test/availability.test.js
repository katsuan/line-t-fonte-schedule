// 施設の空き状況（15_availability.gs）：「#灘崎」「#灘崎 10-13」「#灘崎 土日」と、途中がうまっている時間帯
"use strict";
const { makeGas, planRow, plain, checkMessages } = require("./helpers");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const event = (text) => ({ type: "message", source: { type: "group", groupId: "G1", userId: "U1" }, message: { type: "text", text } });
const res = (status, body) => ({ getResponseCode: () => status, getContentText: () => JSON.stringify(body) });

// 10〜14時の1時間ごとの枠。A01 利用可能・A02 空き状況のみ・R03 空きなし・U09 設備保守
const FRAMES = [10, 11, 12, 13].map((h, i) => ({ usageTimeFrameId: i + 1, usageStartTime: `${h}:00:00`, usageEndTime: `${h + 1}:00:00` }));
const day = (date, codes) => ({ usageDate: `${date}T00:00:00`, usageTimes: codes.map((c, i) => ({ usageTimeFrameId: i + 1, statusType: c })) });
const SITE = {
  timeFrames: [{ usageTimeFrames: FRAMES }],
  rooms: [{
    roomName: "フットサルコート",
    courts: [
      { courtName: "コート1", dayBooks: [
        day("2026-11-10", ["A01", "R03", "A01", "R03"]), // 10-11 と 12-13 だけ（途中の 11-12 がうまっている）
        day("2026-11-11", ["A01", "A02", "A01", "R03"]), // 10-13 はつながっている（11-12 は空き状況のみ）
        day("2026-11-14", ["A01", "A01", "A01", "A01"]),  // 土曜
        day("2026-11-16", ["U09", "U09", "U09", "U09"]),
      ] },
      { courtName: "コート2", dayBooks: [
        day("2026-11-10", ["A01", "A01", "A01", "R03"]),
        day("2026-11-11", ["R03", "R03", "R03", "R03"]),
        day("2026-11-14", ["R03", "R03", "R03", "R03"]),
        day("2026-11-16", ["U09", "U09", "U09", "U09"]),
      ] },
    ],
  }],
};

function setup(fetch, plans) {
  const gas = makeGas({ now: "2026-11-10T08:00:00+09:00", plans: plans || [], fetch: fetch || ((url) => (/GetDay/.test(url) ? res(200, SITE) : undefined)) });
  const reply = (text) => plain(gas.call("handleTextMessage", event(text)));
  return { gas, reply };
}

const COLOR_TO_MARK = { "#2DA44E": "O", "#A8DFB8": "v", "#E3E5E8": "x", "#F7F7F7": "-" };
const cellMark = (c) => (c.contents[0] && c.contents[0].text === "⚽" ? "⚽" : COLOR_TO_MARK[c.backgroundColor] || "?");

/**
 * カードの表を読みやすい文字にする。マスの行は「11/10(火) ① OxO」（O 予約できる・v 空き状況のみ/一部・x 空きなし・- 時間の外）、
 * まとめた空きなしの行はそのままの文字
 */
function grid(bubble) {
  const out = [];
  let date = "";
  for (const x of bubble.body.contents) {
    if (x.type === "text") {
      if (/^\d+\/\d+\([^)]*\)$/.test(x.text)) date = x.text; // 日付の行
      else out.push(x.text);
      continue;
    }
    if (x.type === "box" && x.layout === "baseline") { // ⚽ つきの日付の行
      date = x.contents[0].text;
      out.push(`${date} ${x.contents.slice(1).map((c) => c.text).join(" ")}`);
      continue;
    }
    if (x.type !== "box" || x.contents.length !== 2) continue;
    const [label, cells] = x.contents;
    if (!cells.contents || !cells.contents.some((c) => c.backgroundColor)) continue; // 時刻の目もり
    const marks = cells.contents.map((c) => cellMark(c).repeat(c.flex || 1)).join("");
    out.push(`${date} ${label.contents[0] ? label.contents[0].text : ""} ${marks}`);
  }
  return out;
}

test("時間帯の途中がうまっていたら、そのマスだけ空きなしの色にする", () => {
  const { reply } = setup();
  const [card] = reply("#灘崎 10-13");
  assert.equal(card.type, "flex");
  assert.equal(card.sender.name, "T-FONTE");
  const rows = grid(card.contents);
  assert.ok(rows.includes("11/10(火) ① OxO"), rows.join("\n"));
  assert.ok(rows.includes("11/10(火) ② OOO"), rows.join("\n"));
  // 利用可能と空き状況のみがつながっていれば、空き状況のみのマスだけうすい色
  assert.ok(rows.includes("11/11(水) ① OvO"), rows.join("\n"));
  assert.ok(rows.includes("11/11(水) ② xxx"), rows.join("\n"));
  assert.ok(rows.includes("11/16(月)　空きなし（設備保守）"), rows.join("\n"));
  assert.deepEqual(checkMessages([card]).filter((p) => p.level === "error"), []);
});

test("空いている時間がつながるところは、最初のマスに始まり、最後のマスに終わりの時刻を書く", () => {
  const { reply } = setup();
  const bubble = reply("#灘崎")[0].contents;
  const labels = (date, mark) => {
    let current = "";
    for (const x of bubble.body.contents) {
      if (x.type === "text" && /^\d+\/\d+\([^)]*\)$/.test(x.text)) current = x.text;
      if (current === date && x.type === "box" && x.contents.length === 2 && x.contents[0].contents[0] && x.contents[0].contents[0].text === mark) {
        return x.contents[1].contents.map((c) => (c.contents[0] ? c.contents[0].text : "."));
      }
    }
  };
  // 10-11・12-13 が空き（11-12・13-14 はうまっている）→ 1マスだけの空きは始まりの時刻
  assert.deepEqual(labels("11/10(火)", "①"), ["10", ".", "12", "."]);
  // 10-13 がつながって空き → 最初に 10、最後に 13
  assert.deepEqual(labels("11/10(火)", "②"), ["10", ".", "13", "."]);
});

test("#灘崎 2-4w は2週後からの2週間を取る（1-3w のように1週ずらしも）。カードは直近2週間に、予約サイトと90日の表のボタン（「次の2週間」ボタンは出さない）", () => {
  const asked = [];
  const { gas, reply } = setup((url, opt) => {
    if (!/GetDay/.test(url)) return undefined;
    asked.push(JSON.parse(opt.payload));
    return res(200, SITE);
  });
  const [card] = reply("#灘崎 土日 19-21");
  assert.deepEqual(card.contents.footer.contents.map((b) => [b.action.type, b.action.label]), [
    ["uri", "予約サイトで見る"], ["uri", "90日の表を見る"],
  ]);
  reply("#灘崎 2-4w 土日 19-21"); // 手で書けば先の2週間も見られる
  assert.deepEqual(asked.map((a) => [a.startDate, a.endDate]), [["2026-11-10", "2026-11-23"], ["2026-11-24", "2026-12-07"]]);
  assert.equal(reply("#灘崎 4-6w")[0].contents.body.contents[1].text.startsWith("12/8〜12/21の空き状況"), true);
  assert.equal(reply("#灘崎 1〜3週")[0].contents.body.contents[1].text.startsWith("11/17〜11/30の空き状況"), true);
  assert.equal(reply("#灘崎 1-2w")[0].contents.body.contents[1].text.startsWith("11/17〜11/23の空き状況"), true);
  // 幅が3週より広い・12週より先・前の書き方「次」は、書き方の例を返す
  for (const bad of ["#灘崎 0-4w", "#灘崎 12-14w", "#灘崎 次"]) assert.match(JSON.stringify(reply(bad)), /書き方の例/, bad);

  // ページへのリンクがないボット（ひしょっと）では、これまでどおり「次の2週間」ボタンで曜日・時間帯をそのまま送る
  gas.ctx.availabilityExtraLinks_ = undefined;
  const [plain2] = reply("#灘崎 土日 19-21");
  const next = plain2.contents.footer.contents.find((b) => b.action.type === "message");
  assert.equal(next.action.text, "#灘崎 2-4w 土日 19-21時");
  assert.equal(next.action.label, "次の2週間");
});

test("#灘崎 全部 は、12週目まで2週間ずつのカードを横に並べる（サイトは90日ぶんを1回だけ読む）。入らなければ入るぶんだけ", () => {
  // 11/10 から90日ぶん。土曜の 10-12時だけ空き、ほかは空きなし（本物も、空きなしの日が多い）
  const days = [];
  for (let i = 0; i < 90; i++) {
    const d = new Date(Date.UTC(2026, 10, 10 + i)).toISOString().slice(0, 10);
    days.push(day(d, i % 7 === 4 ? ["A01", "A01", "R03", "R03"] : ["R03", "R03", "R03", "R03"]));
  }
  const site = { timeFrames: SITE.timeFrames, rooms: [{ roomName: "フットサルコート", courts: [{ courtName: "コート1", dayBooks: days }, { courtName: "コート2", dayBooks: days }] }] };
  const asked = [];
  const { gas, reply } = setup((url, opt) => {
    if (!/GetDay/.test(url)) return undefined;
    asked.push(JSON.parse(opt.payload));
    return res(200, site);
  });
  const [msg] = reply("#灘崎 全部 10-12");
  assert.equal(msg.contents.type, "carousel");
  assert.equal(msg.contents.contents.length, 6);
  assert.deepEqual(asked.map((a) => [a.startDate, a.period]), [["2026-11-10", 90]]);
  const titles = msg.contents.contents.map((b) => b.body.contents[1].text.split("の空き状況")[0]);
  assert.deepEqual(titles, ["11/10〜11/23 10-12時", "11/24〜12/7 10-12時", "12/8〜12/21 10-12時", "12/22〜1/4 10-12時", "1/5〜1/18 10-12時", "1/19〜2/1 10-12時"]);
  assert.match(msg.altText, /11\/10〜2\/1 10-12時の空き状況/);
  assert.ok(JSON.stringify(msg).length <= 48000);

  // ページへのリンクがないボット（ひしょっと）で入りきらないときは、最後のカードに続きのボタン
  gas.ctx.availabilityExtraLinks_ = undefined;
  const [wide] = reply("#灘崎 全部");
  const bubbles = wide.contents.type === "carousel" ? wide.contents.contents : [wide.contents];
  assert.ok(JSON.stringify(wide).length <= 48000);
  if (bubbles.length < 6) {
    const next = bubbles[bubbles.length - 1].footer.contents.find((b) => b.action.type === "message");
    assert.equal(next.action.text, `#灘崎 ${bubbles.length * 2}-${bubbles.length * 2 + 2}w`);
  }
  // 「全部」と「これから」「2-4w」はいっしょにしない
  for (const bad of ["#灘崎 全部 2-4w", "#灘崎 全部 これから"]) assert.match(JSON.stringify(reply(bad)), /書き方の例/, bad);
});

test("時間帯の外側だけ空いていても、時間帯の中がうまっていれば空きなしの日にまとめる", () => {
  const { reply } = setup();
  const rows = grid(reply("#灘崎 13-14")[0].contents);
  assert.ok(rows.includes("11/10(火)〜11/11(水)　空きなし"), rows.join("\n"));
  assert.ok(rows.includes("11/14(土) ① O"), rows.join("\n"));
});

test("#灘崎 土日 は土日の日だけ。#灘崎 だけなら受け付けている時間ぜんぶの列", () => {
  const { reply } = setup();
  assert.deepEqual(grid(reply("#灘崎 土日")[0].contents).filter((r) => /^\d.*(①|②)/.test(r)), ["11/14(土) ① OOOO", "11/14(土) ② xxxx"]);
  const all = grid(reply("#灘崎")[0].contents);
  assert.ok(all.includes("11/10(火) ① OxOx"), all.join("\n"));
  assert.ok(all.includes("11/11(水) ① OvOx"), all.join("\n"));
});

test("2週間ずっと空いていても、LINE のカードの大きさの上限をこえない", () => {
  const frames = Array.from({ length: 14 }, (_, i) => ({ usageTimeFrameId: i + 1, usageStartTime: `${7 + i}:00:00`, usageEndTime: `${8 + i}:00:00` }));
  const dates = Array.from({ length: 14 }, (_, i) => `2026-11-${String(10 + i).padStart(2, "0")}`);
  // 1時間おきに色がかわる（つなげても小さくならない、いちばん大きくなる形）
  const books = (k) => dates.map((d) => day(d, frames.map((_, i) => ((i + k) % 2 ? "A01" : "A02"))));
  const site = { timeFrames: [{ usageTimeFrames: frames }], rooms: [{ roomName: "フットサルコート", courts: [
    { courtName: "コート1", dayBooks: books(0) }, { courtName: "コート2", dayBooks: books(1) }] }] };
  const { reply } = setup((url) => (/GetDay/.test(url) ? res(200, site) : undefined));
  const messages = reply("#灘崎");
  assert.ok(messages.length >= 1 && messages.length <= 5, `${messages.length}通`);
  const size = (x) => JSON.stringify(x).length;
  const bubbles = [];
  for (const m of messages) {
    assert.equal(m.type, "flex");
    if (m.contents.type === "carousel") {
      assert.ok(size(m.contents) <= 50000, `束 ${size(m.contents)}`);
      bubbles.push(...m.contents.contents);
    } else {
      bubbles.push(m.contents);
    }
  }
  bubbles.forEach((b) => assert.ok(size(b) <= 30000, `1枚 ${size(b)}`));
  // 分けても、どの日も1回ずつ出る。ボタンは最後の1枚だけ
  assert.equal(bubbles.flatMap((b) => grid(b).filter((r) => /^\d.*①/.test(r))).length, 14);
  assert.equal(bubbles.filter((b) => b.footer).length, messages.length > 1 ? 1 : bubbles.filter((b) => b.footer).length);
});

test("灘崎での活動の予定があれば、日付の行に ⚽ と時間とコート、そのコートのその時間のマスに ⚽ を入れる", () => {
  const plans = [
    planRow("2026-11-10", "11:00", "12:00", "灘崎総合公園", "⚽フットサル", "①"),          // 登録の形：補足に ①
    planRow("2026-11-11", "12:00", "14:00", "灘崎総合公園", "⚽フットサル コート①②"),     // 手で書いた形：内容に コート①②
    planRow("2026-11-16", "10:00", "", "灘崎町総合公園", "⚽フットサル"),                    // コートなし・終了が空 → 2時間。設備保守の日でもまとめない
    planRow("2026-11-14", "10:00", "12:00", "体育館", "🏆大会"),                            // ほかの場所は出さない
  ];
  const { reply } = setup(undefined, plans);
  const rows = grid(reply("#灘崎")[0].contents);
  const has = (row) => assert.ok(rows.includes(row), `${row}\n---\n${rows.join("\n")}`);
  has("11/10(火) ⚽ 11-12時 ①");
  has("11/10(火) ① O⚽Ox");
  has("11/10(火) ② OOOx");
  has("11/11(水) ⚽ 12-14時 ①②");
  has("11/11(水) ① Ov⚽⚽");
  has("11/11(水) ② xx⚽⚽");
  // どのコートかわからない予定は、その時間の空きなしのマスに
  has("11/16(月) ⚽ 10-12時");
  has("11/16(月) ① ⚽⚽xx");
  assert.ok(!rows.some((r) => /11\/14.*⚽/.test(r)), rows.join("\n"));
});

test("日付の文字は、土曜は青、日曜・祝日は赤。祝日は「(水・祝)」。#灘崎 土日祝 は祝日も入る", () => {
  const site = Object.assign({}, SITE, { holidays: [{ holidayDate: "2026-11-11T00:00:00", holidayName: "ためしの祝日" }] });
  const { reply } = setup((url) => (/GetDay/.test(url) ? res(200, site) : undefined));
  const dates = (bubble) => bubble.body.contents
    .filter((x) => x.type === "text" && /^\d+\/\d+\([^)]*\)$/.test(x.text))
    .map((x) => `${x.text} ${x.color}`);
  assert.deepEqual(dates(reply("#灘崎 10-13")[0].contents), [
    "11/10(火) #111111", "11/11(水・祝) #CF222E", "11/14(土) #0969DA",
  ]);
  assert.deepEqual(dates(reply("#灘崎 土日祝")[0].contents).map((d) => d.split(" ")[0]), ["11/11(水・祝)", "11/14(土)"]);
  assert.match(reply("#灘崎 土日祝")[0].contents.body.contents[1].text, /^土日祝の空き状況/);
  assert.deepEqual(dates(reply("#灘崎 土日")[0].contents).map((d) => d.split(" ")[0]), ["11/14(土)"]);
});

test("handleAvailabilityDigest は90日ぶんを1回で取り、時間帯に空きのある日だけのカードを1通。なければ何も返さない", () => {
  const asked = [];
  const { gas } = setup((url, opt) => {
    if (!/GetDay/.test(url)) return undefined;
    asked.push(JSON.parse(opt.payload));
    return res(200, SITE);
  });
  const [card, ...rest] = plain(gas.call("handleAvailabilityDigest", "#灘崎 13-14"));
  assert.equal(rest.length, 0);
  assert.equal(asked.length, 1);
  assert.deepEqual([asked[0].startDate, asked[0].endDate, asked[0].period], ["2026-11-10", "2027-02-07", 90]);
  const rows = grid(card.contents).filter((r) => /^\d+\/\d+\(/.test(r));
  // 13-14 に空きがあるのは 11/14 だけ（ほかの日は出さない・まとめた空きなしの行もない）
  assert.deepEqual(rows, ["11/14(土) ① O", "11/14(土) ② x"]);
  // 「次の2週間」ボタンは付けない。予約サイトと、管理ページの90日の表（T-FONTE だけ）
  assert.deepEqual(card.contents.footer.contents.map((b) => b.action.label), ["予約サイトで見る", "90日の表を見る"]);
  assert.match(card.contents.footer.contents[1].action.uri, /^https:\/\/liff\.line\.me\/[^/]+\/admin\.html\?view=field$/);
  assert.deepEqual(plain(gas.call("handleAvailabilityDigest", "#灘崎 20-21")), []);
  assert.deepEqual(plain(gas.call("handleAvailabilityDigest", "#灘崎 あした")), []);
});

test("#灘崎 見張り：見る・入れかえ・足す・消す・全部消す。カードのボタンでいまの日付を写せる（ひしょっとの機能。T-FONTE のトークでは受けない）", () => {
  const { gas } = setup();
  assert.equal(gas.call("handleTextMessage", event("#灘崎 見張り")), undefined);
  // 共通のファイルの入口を直接よぶ（ひしょっとと同じ動き）
  const reply = (text) => plain(gas.call("handleAvailabilityText", text));
  const lines = (card) => card.contents.body.contents.filter((x) => x.type === "text").map((x) => x.text);
  const copy = (card) => card.contents.footer.contents[0].action;

  let [card] = reply("#灘崎 見張り");
  assert.ok(lines(card).includes("まだありません"));

  // 11/5 は過ぎた日（60日以内なので今年）なので入れない。1/13 は来年
  [card] = reply("#灘崎 見張り 11/5 12月11日 １２/１７ 1/13");
  assert.equal(card.altText, "灘崎の見張る日: 12/11 12/17 1/13");
  assert.ok(lines(card).some((l) => l.includes("11/5(木) は過ぎているので入れませんでした。")), lines(card).join("\n"));
  assert.ok(lines(card).includes("1/13(水)"), lines(card).join("\n"));
  assert.deepEqual(copy(card), { type: "clipboard", label: "いまの日付をコピー", clipboardText: "#灘崎 見張り 12/11 12/17 1/13" });
  assert.equal(gas.ctx.PropertiesService.getScriptProperties().getProperty("AVAILABILITY_WATCH_DATES_灘崎"), JSON.stringify(["2026-12-11", "2026-12-17", "2027-01-13"]));

  [card] = reply("#灘崎 見張り + 12/24");
  assert.equal(card.altText, "灘崎の見張る日: 12/11 12/17 12/24 1/13");
  [card] = reply("#灘崎 見張り -12/11");
  assert.equal(card.altText, "灘崎の見張る日: 12/17 12/24 1/13");
  [card] = reply("#灘崎 見張り 削除 11/5 12/24");
  assert.equal(card.altText, "灘崎の見張る日: 12/17 1/13");
  assert.ok(lines(card).some((l) => l.includes("11/5(木) はもともと入っていません。")), lines(card).join("\n"));
  // 前に付けた + - は、その日付だけに効く（1つの文で足して消せる）
  [card] = reply("#灘崎 見張り +1/3 +12/24");
  assert.equal(card.altText, "灘崎の見張る日: 12/17 12/24 1/3 1/13");
  [card] = reply("#灘崎 見張り -1/3 +12/25");
  assert.equal(card.altText, "灘崎の見張る日: 12/17 12/24 12/25 1/13");
  assert.ok(lines(card).some((l) => l.includes("12/25(金) を足しました。\n1/3(日) を消しました。")), lines(card).join("\n"));
  [card] = reply("#灘崎 見張り - 12/24 12/25");
  assert.equal(card.altText, "灘崎の見張る日: 12/17 1/13");
  // 読めない日付は書きかえない
  [card] = reply("#灘崎 見張り + 2/30");
  assert.match(lines(card).join("\n"), /「\+ 2\/30」|「2\/30」/);
  assert.equal(card.altText, "灘崎の見張る日: 12/17 1/13");
  [card] = reply("#灘崎 見張り 全部消す");
  assert.equal(card.altText, "灘崎の見張る日: なし");
  assert.deepEqual(checkMessages([card]).filter((p) => p.level === "error"), []);
});

test("見張る日のカードの「いま空きを見る」ボタンで、毎日のカードと同じものがすぐ返る", () => {
  const { gas } = setup();
  const reply = (text) => plain(gas.call("handleAvailabilityText", text));
  const [watch] = reply("#灘崎 見張り 11/14");
  const check = watch.contents.footer.contents.find((b) => b.action.type === "message");
  assert.deepEqual(check.action, { type: "message", label: "いま空きを見る", text: "#灘崎 これから 19-21" });
  // 手で時間帯を変えても同じ（13-14 なら 11/14 に空き。見張る日なので目立つ色）
  const [card] = reply("#灘崎 これから 13-14");
  assert.match(card.altText, /^【見張る日に空き】/);
  assert.deepEqual(grid(card.contents).filter((r) => /^\d+\/\d+\(/.test(r)), ["11/14(土) 見張る日", "11/14(土) ① O", "11/14(土) ② x"]);
  // 見張る日がなく空きもないときは、送ってきた人にはそう返す
  reply("#灘崎 見張り 全部消す");
  const [none] = reply("#灘崎 これから");
  assert.equal(none.type, "text");
  assert.match(none.text, /19-21時に、空きのある日はありません/);
});

test("過ぎた見張る日は、日がたつと消えていく", () => {
  const { gas } = setup();
  const reply = (text) => plain(gas.call("handleAvailabilityText", text));
  reply("#灘崎 見張り 11/11 11/14 12/11");
  gas.setNow("2026-11-12T08:00:00+09:00");
  assert.equal(reply("#灘崎 見張り")[0].altText, "灘崎の見張る日: 11/14 12/11");
  gas.setNow("2026-11-15T08:00:00+09:00");
  plain(gas.call("handleAvailabilityDigest", "#灘崎 13-14")); // 毎日のカードを作るときにも消す
  assert.equal(gas.ctx.PropertiesService.getScriptProperties().getProperty("AVAILABILITY_WATCH_DATES_灘崎"), JSON.stringify(["2026-12-11"]));
});

test("見張る日があれば、毎日のカードの上に「見張る日」の欄をいつも出す（空きがなくても返す）", () => {
  const { gas } = setup();
  const reply = (text) => plain(gas.call("handleAvailabilityText", text));
  const watchRows = (card) => {
    const box = card.contents.body.contents.find((x) => x.type === "box" && x.contents[0] && x.contents[0].text === "見張る日");
    return box ? box.contents.slice(1).map((r) => r.contents.map((c) => c.text).join(" ")) : null;
  };
  // 20-21 はどの日も空きなし。見張る日がなければ何も返さない
  assert.deepEqual(plain(gas.call("handleAvailabilityDigest", "#灘崎 20-21")), []);
  // 見張る日があれば、空きがなくてもカードを返して、その様子を見せる
  reply("#灘崎 見張り 11/16");
  let [card] = plain(gas.call("handleAvailabilityDigest", "#灘崎 20-21"));
  assert.deepEqual(watchRows(card), ["11/16(月) この時間の枠がありません"]);
  assert.ok(card.contents.body.contents.some((x) => x.text === "この時間の空きは、いまはありません"));
  // 空きなし・設備保守・サイトにまだない先の日
  reply("#灘崎 見張り 11/10 11/16 3/1");
  [card] = plain(gas.call("handleAvailabilityDigest", "#灘崎 13-14"));
  assert.deepEqual(watchRows(card), [
    "11/10(火) 空きなし",
    "11/16(月) 空きなし（設備保守）",
    "3/1(月) まだ見られません（サイトにまだない先の日）",
  ]);
  // 見張る日に空きがあれば「空きあり」
  reply("#灘崎 見張り 11/14");
  [card] = plain(gas.call("handleAvailabilityDigest", "#灘崎 13-14"));
  assert.deepEqual(watchRows(card), ["11/14(土) 空きあり"]);
});

test("これからの空きは見張る日以外も出す。見張る日に空きがあれば目立つ色にして、その日に「見張る日」の印", () => {
  const { gas } = setup();
  const reply = (text) => plain(gas.call("handleAvailabilityText", text));
  // 13-14 に空きがあるのは 11/14 だけ
  const digest = () => plain(gas.call("handleAvailabilityDigest", "#灘崎 13-14"));

  // 見張る日がないときは、ふつうの色
  let [card] = digest();
  assert.equal(card.contents.styles, undefined);
  assert.doesNotMatch(card.altText, /見張る日に空き/);

  // 見張る日（11/10）に空きがなくても、ほかの日（11/14）は出す。色はふつう
  reply("#灘崎 見張り 11/10");
  [card] = digest();
  assert.equal(card.contents.styles, undefined);
  assert.deepEqual(grid(card.contents).filter((r) => /^\d+\/\d+\(/.test(r)), ["11/14(土) ① O", "11/14(土) ② x"]);

  // 見張る日（11/14）に空きがあれば、目立つ色（地はうすいオレンジ・上に帯）と、通知の文の頭に【見張る日に空き】
  reply("#灘崎 見張り + 11/14");
  [card] = digest();
  assert.match(card.altText, /^【見張る日に空き】/);
  assert.equal(card.contents.styles.body.backgroundColor, "#FFF4E5");
  assert.equal(card.contents.body.contents[0].contents[0].text, "見張る日に空きがあります（11/14(土)）");
  const rows = grid(card.contents).filter((r) => /^\d+\/\d+\(/.test(r));
  assert.deepEqual(rows, ["11/14(土) 見張る日", "11/14(土) ① O", "11/14(土) ② x"]);
  assert.deepEqual(checkMessages([card]).filter((p) => p.level === "error"), []);
});

test("予約サイトはボタン。読めない書き方には例を返し、ほかの # の言葉には反応しない", () => {
  const { reply, gas } = setup();
  const [card] = reply("#灘崎");
  assert.equal(card.contents.footer.contents[0].action.type, "uri");
  assert.match(card.contents.footer.contents[0].action.uri, /FacilityAvailability\/Index\/331007\/0029/);
  assert.match(reply("#灘崎 あした")[0].text, /#灘崎 19-21/);
  // # のあとに空白があっても、全角の ＃・全角の空白でも読む
  for (const text of ["# 灘崎", "＃灘崎", "#　灘崎", "# 灘崎 19-21", "#灘崎　土日"]) {
    assert.equal(gas.call("isAvailabilityText", text), true, text);
  }
  assert.equal(reply("# 灘崎 10-13")[0].type, "flex");
  assert.equal(gas.call("isAvailabilityText", "#岡山"), false);
  assert.equal(gas.call("isAvailabilityText", "#今後の予定"), false);
});

test("取れないときは、つながらないのか作りが変わったのかを分けて、エラーの中身を出さずにリンクと返す", () => {
  const raw = (status, text) => ({ getResponseCode: () => status, getContentText: () => text });
  const say = (fetch, text = "#灘崎") => {
    const { reply } = setup((url) => (/GetDay/.test(url) ? fetch() : undefined));
    return reply(text);
  };
  // つながらない（応答 500）
  let [msg] = say(() => res(500, { secret: "x" }));
  assert.equal(msg.type, "text");
  assert.match(msg.text, /サイトにつながりませんでした/);
  assert.match(msg.text, /FacilityAvailability\/Index/);
  assert.doesNotMatch(msg.text, /500|secret/);
  // 作りが変わった：JSON でない（工事中のページなど）・rooms がない・枠が1つも読めない
  for (const fetch of [() => raw(200, "<html>メンテナンス中</html>"), () => res(200, { items: [] }), () => res(200, { rooms: [], timeFrames: [] })]) {
    [msg] = say(fetch);
    assert.equal(msg.type, "text");
    assert.match(msg.text, /サイトの作りが変わったようで/);
  }
});

test("知らない状態のコードがあれば、カードでお知らせする（毎日のカードは空きがなくても知らせる）", () => {
  const site = JSON.parse(JSON.stringify(SITE));
  site.rooms[0].courts[1].dayBooks[1].usageTimes[3].statusType = "Z99"; // 11/11 ② 13-14
  const { reply, gas } = setup((url) => (/GetDay/.test(url) ? res(200, site) : undefined));
  const [card] = reply("#灘崎");
  const texts = card.contents.body.contents.filter((x) => x.type === "text").map((x) => x.text);
  assert.ok(texts.includes("見慣れない状態（Z99）があります。灰色にしているので、サイトで確かめてください。"), texts.join("\n"));
  // 毎日のカード：その時間帯に空きがなくても、見慣れない状態があれば文で知らせる
  const [notice] = plain(gas.call("handleAvailabilityDigest", "#灘崎 20-21"));
  assert.equal(notice.type, "text");
  assert.match(notice.text, /見慣れない状態（Z99）/);
});

test("毎日のカード（handleAvailabilityDigest）も、取れなかったら黙らずに文で知らせる", () => {
  const { gas } = setup((url) => (/GetDay/.test(url) ? res(503, {}) : undefined));
  const messages = plain(gas.call("handleAvailabilityDigest", "#灘崎 19-21"));
  assert.equal(messages.length, 1);
  assert.match(messages[0].text, /取れませんでした/);
});

test("ウィジェット用の中身（buildAvailabilityApiPayload）：表のもと・見張る日・読めないとき・書き方のまちがい", () => {
  const { gas } = setup();
  const reply = (text) => plain(gas.call("handleAvailabilityText", text));
  let p = plain(gas.call("buildAvailabilityApiPayload", "#灘崎 10-13"));
  assert.equal(p.status, "ok");
  assert.deepEqual(p.hours, [600, 660, 720]);
  assert.deepEqual(p.courts, ["コート1", "コート2"]);
  const day = p.days.find((d) => d.date === "2026-11-10");
  assert.deepEqual(day.cells, { "コート1": ["open", "closed", "open"], "コート2": ["open", "open", "open"] });
  assert.equal(p.nextQuery, "#灘崎 2-4w 10-13時");
  assert.match(p.pageUrl, /FacilityAvailability\/Index/);
  // これからの空き：空きのある日だけ・見張る日の印と様子
  reply("#灘崎 見張り 11/14 12/1");
  p = plain(gas.call("buildAvailabilityApiPayload", "#灘崎 これから 13-14"));
  assert.equal(p.digest, true);
  assert.deepEqual(p.days.map((d) => [d.date, d.watched]), [["2026-11-14", true]]);
  assert.equal(p.alert, true);
  assert.deepEqual(p.watch.map((w) => w.text), ["空きあり", "まだ見られません（サイトにまだない先の日）"]);
  // 書きかえ・読めない書き方は受けない
  assert.equal(plain(gas.call("buildAvailabilityApiPayload", "#灘崎 見張り + 12/24")).status, "bad");
  assert.equal(plain(gas.call("buildAvailabilityApiPayload", "#灘崎 あした")).status, "bad");
  // 読めないときは投げずに status で
  const down = setup((url) => (/GetDay/.test(url) ? res(503, {}) : undefined));
  assert.equal(plain(down.gas.call("buildAvailabilityApiPayload", "#灘崎")).status, "down");
  const changed = setup((url) => (/GetDay/.test(url) ? res(200, { rooms: [] }) : undefined));
  assert.equal(plain(changed.gas.call("buildAvailabilityApiPayload", "#灘崎")).status, "changed");
});

test("管理ページ用（spanDays）：今日から90日・空きのない日も・見張る日の印と様子・活動の日", () => {
  const plans = [planRow("2026-11-14", "10:00", "12:00", "灘崎総合公園", "⚽フットサル", "①")];
  const { gas } = setup(undefined, plans);
  plain(gas.call("handleAvailabilityText", "#灘崎 見張り 11/14 11/16"));
  const p = plain(gas.call("buildAvailabilityApiPayload", "#灘崎", undefined, { spanDays: 90 }));
  assert.equal(p.status, "ok");
  assert.equal(p.digest, false);
  assert.equal(p.nextQuery, "");
  assert.match(p.title, /^11\/10〜2\/7の空き状況$/);
  assert.match(p.pageUrl, /ed=2027-02-07/);
  assert.deepEqual(p.days.map((d) => [d.date, d.open, d.watched]), [
    ["2026-11-10", true, false], ["2026-11-11", true, false], ["2026-11-14", true, true], ["2026-11-16", false, true],
  ]);
  assert.deepEqual(p.days.find((d) => d.date === "2026-11-14").activities, [{ start: 600, end: 720, courts: [1] }]);
  assert.deepEqual(p.watch.map((w) => [w.date, w.open]), [["2026-11-14", true], ["2026-11-16", false]]);
  // 90日より長くは読まない
  assert.match(plain(gas.call("buildAvailabilityApiPayload", "#灘崎", undefined, { spanDays: 365 })).pageUrl, /ed=2027-02-07/);
});

test("ひしょっと（GAS_assistant）の元のファイルと中身が同じ", (t) => {
  const original = path.join(process.env.HOME, "GitHub/GAS_assistant/30_domain/05_availability_service.gs");
  if (!fs.existsSync(original)) return t.skip("GAS_assistant が手元にない");
  assert.equal(fs.readFileSync(path.join(__dirname, "../15_availability.gs"), "utf8"), fs.readFileSync(original, "utf8"));
});
