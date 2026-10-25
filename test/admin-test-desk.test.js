// 管理者のテストの窓口（#テスト）
"use strict";
const { makeGas, planRow, plain, checkMessages } = require("./helpers");
const test = require("node:test");
const assert = require("node:assert");

const ADMIN = "U_ADMIN";
const say = (gas, text, userId = ADMIN) =>
  gas.call("handleTextMessage", { type: "message", source: { type: "group", groupId: "G1", userId }, message: { type: "text", text } });
const make = () => makeGas({
  now: "2026-10-23T08:00:00+09:00",
  properties: { ADMIN_USER_IDS: `U_OTHER,${ADMIN}`, CALENDAR_ID: "abc@group.calendar.google.com" },
  plans: [planRow("2026-10-24", "10:00", "12:00", "本物の場所", "本物の予定")],
});
const KEYS = ["一覧", "共有", "登録", "登録済み", "古いカード", "文", "断られ", "点検"];

test("管理者が #テスト と送ると、🧪 テストのカードと、試せるもののクイックリプライが返る", () => {
  const gas = make();
  for (const text of ["#テスト", "#test", "#TEST", "#テスト なにか"]) {
    const reply = plain(say(gas, text));
    assert.equal(reply.length, 1, text);
    assert.match(reply[0].altText, /^🧪/);
    assert.deepEqual(reply[0].quickReply.items.map((it) => it.action.text), [...KEYS.map((k) => `#テスト ${k}`), "#テスト"]);
    assert.deepEqual(checkMessages(reply).filter((p) => p.level === "error"), []);
  }
});

test("ふつうの人・ID がわからない人には、知らない言葉と同じ（何も返さない）", () => {
  const gas = make();
  assert.equal(say(gas, "#テスト", "U_STRANGER"), undefined);
  assert.equal(say(gas, "#テスト 点検", "U_STRANGER"), undefined);
  assert.equal(say(gas, "#テスト", null), undefined);
  assert.equal(say(gas, "こんにちは"), undefined);
});

test("見本はすべて 🧪 付きで LINE が受けつける形。本物の予定は出さず、シート・設定・登録待ちに書かない", () => {
  const gas = make();
  const before = JSON.stringify(gas.properties);
  const planBefore = JSON.stringify(gas.plan.rows);
  gas.reset();
  for (const key of KEYS) {
    const reply = plain(say(gas, `#テスト ${key}`));
    assert.ok(reply.length >= 1 && reply.length <= 5, `${key}: ${reply.length}通`);
    assert.deepEqual(checkMessages(reply).filter((p) => p.level === "error"), [], key);
    reply.forEach((m) => {
      assert.match(m.type === "text" ? m.text : m.altText, /^🧪/, key);
      assert.equal(m.sender.name, "🧪 T-FONTE テスト");
      if (key !== "点検") assert.doesNotMatch(JSON.stringify(m), /本物の/, key);
    });
    // 見本から本物の操作（#予定確定 など）に進まない（クイックリプライもカードのボタンも）
    assert.ok(reply[reply.length - 1].quickReply.items.every((it) => /^#テスト/.test(it.action.text)), key);
    const sent = JSON.stringify(reply).match(/"text":"#[^"]*"/g) || [];
    assert.ok(sent.every((t) => /"text":"#テスト/.test(t)), `${key}: ${sent}`);
  }
  assert.equal(JSON.stringify(gas.properties), before);
  assert.equal(JSON.stringify(gas.plan.rows), planBefore);
  assert.deepEqual(gas.writes.filter((w) => w.sheet !== "DebugLog"), []);
  assert.deepEqual(Object.keys(gas.cache), []);
  assert.deepEqual(gas.fetches, []); // push もほかの問い合わせもしない
});

test("自己点検：本物の設定を読み、足りないものを知らせる", () => {
  const gas = make();
  const card = JSON.stringify(plain(say(gas, "#テスト 点検"))[0].contents);
  assert.match(card, /予定 1件/);
  assert.match(card, /5日後まで/);
  assert.match(card, /2人/);
  assert.match(card, /onPlanSheetChanged/); // 偽物の GAS にはトリガーがない

  const empty = makeGas({ now: "2026-10-23T08:00:00+09:00", remindNum: "", properties: { ADMIN_USER_IDS: ADMIN } });
  const emptyCard = JSON.stringify(plain(say(empty, "#テスト 点検"))[0].contents);
  assert.match(emptyCard, /数字になっていません/);
  assert.match(emptyCard, /CALENDAR_ID が未設定/);
});
