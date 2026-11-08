// 施設の空き状況（15_availability.gs）：「#灘崎」「#灘崎 10-13」「#灘崎 土日」と、途中がうまっている時間帯
"use strict";
const { makeGas, plain, checkMessages } = require("./helpers");
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

function setup(fetch) {
  const gas = makeGas({ now: "2026-11-10T08:00:00+09:00", fetch: fetch || ((url) => (/GetDay/.test(url) ? res(200, SITE) : undefined)) });
  const reply = (text) => plain(gas.call("handleTextMessage", event(text)));
  return { gas, reply };
}

/** カードの表を「日付 | コート1 | コート2」の文字の並びにする */
function table(message) {
  const text = (x) => (x.type === "text" ? (x.text ?? x.contents.map((c) => c.text).join("")) : x.type === "box" ? x.contents.map(text) : "");
  return message.contents.body.contents.filter((x) => x.type === "box").map(text).map((row) => [].concat(...row).join(" | "));
}

test("時間帯の途中がうまっていたら ○ にせず、空いている時間だけを △ で並べる", () => {
  const { reply } = setup();
  const [card] = reply("#灘崎 10-13");
  assert.equal(card.type, "flex");
  assert.equal(card.sender.name, "T-FONTE");
  const rows = table(card);
  assert.ok(rows.includes("11/10(火) | △ 10-11, 12-13時 | ○"), rows.join("\n"));
  // 利用可能と空き状況のみがつながっていれば、まるごと空き（※ を添える）
  assert.ok(rows.includes("11/11(水) | ○※ | —"), rows.join("\n"));
  assert.ok(rows.includes("11/16(月)　空きなし（設備保守）"), rows.join("\n"));
  assert.deepEqual(checkMessages([card]).filter((p) => p.level === "error"), []);
});

test("時間帯の外側だけ空いていても、時間帯の中がうまっていれば空きなし", () => {
  const { reply } = setup();
  const rows = table(reply("#灘崎 13-14")[0]);
  assert.ok(rows.includes("11/10(火)〜11/11(水)　空きなし"), rows.join("\n"));
  assert.ok(rows.includes("11/14(土) | ○ | —"), rows.join("\n"));
});

test("#灘崎 土日 は土日の日だけ。#灘崎 だけなら全部の時間", () => {
  const { reply } = setup();
  assert.deepEqual(table(reply("#灘崎 土日")[0]).slice(1), ["11/14(土) | 10-14時 | —"]);
  const all = table(reply("#灘崎")[0]);
  assert.ok(all.includes("11/10(火) | 10-11, 12-13時 | 10-13時"), all.join("\n"));
  assert.ok(all.includes("11/11(水) | 10-11, 12-13時, 11-12時※ | —"), all.join("\n"));
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
