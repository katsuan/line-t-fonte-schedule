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
      if (/^\d+\/\d+\(.\)$/.test(x.text)) date = x.text; // 日付の行
      else out.push(x.text);
      continue;
    }
    if (x.type === "box" && x.layout === "baseline") { // ⚽ つきの日付の行
      date = x.contents[0].text;
      out.push(`${date} ${x.contents[1].text}`);
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
      if (x.type === "text" && /^\d+\/\d+\(.\)$/.test(x.text)) current = x.text;
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

test("#灘崎 次 は次の2週間を取り、カードの「次の2週間」ボタンは曜日・時間帯をそのまま送る", () => {
  const asked = [];
  const { reply } = setup((url, opt) => {
    if (!/GetDay/.test(url)) return undefined;
    asked.push(JSON.parse(opt.payload));
    return res(200, SITE);
  });
  const [card] = reply("#灘崎 土日 19-21");
  const next = card.contents.footer.contents.find((b) => b.action.type === "message");
  assert.equal(next.action.text, "#灘崎 次 土日 19-21時");
  reply(next.action.text);
  assert.deepEqual(asked.map((a) => [a.startDate, a.endDate]), [["2026-11-10", "2026-11-23"], ["2026-11-24", "2026-12-07"]]);
  assert.equal(reply("#灘崎 次の次")[0].contents.body.contents[1].text.startsWith("12/8〜12/21の空き状況"), true);
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

test("サイトが取れないときは、エラーの中身を出さずリンクだけ返す", () => {
  const { reply } = setup((url) => (/GetDay/.test(url) ? res(500, { secret: "x" }) : undefined));
  const [msg] = reply("#灘崎");
  assert.equal(msg.type, "text");
  assert.match(msg.text, /いまは取れませんでした/);
  assert.doesNotMatch(msg.text, /500|secret/);
});

test("ひしょっと（GAS_assistant）の元のファイルと中身が同じ", (t) => {
  const original = path.join(process.env.HOME, "GitHub/GAS_assistant/30_domain/05_availability_service.gs");
  if (!fs.existsSync(original)) return t.skip("GAS_assistant が手元にない");
  assert.equal(fs.readFileSync(path.join(__dirname, "../15_availability.gs"), "utf8"), fs.readFileSync(original, "utf8"));
});
