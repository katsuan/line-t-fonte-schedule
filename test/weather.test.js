// 天気（14_weather.gs）：場所の位置・予定の時間の天気・CacheService・前の控えを消す・読めないとき
"use strict";
const { makeGas, planRow, plain } = require("./helpers");
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { response } = require(path.join(process.env.HOME, "GitHub/q-oqrn/tools/qtest/fake-gas.js"));

const event = (text) => ({ type: "message", source: { type: "group", groupId: "G1", userId: "U1" }, message: { type: "text", text } });

/** 11/10 0時から16日ぶんの1時間ごとの予報。11/12 20時だけ雨（降水70%・15℃）、ほかは晴れ間（降水10%・12℃） */
function forecast() {
  const start = new Date("2026-11-10T00:00:00+09:00").getTime() / 1000;
  const rainy = new Date("2026-11-12T20:00:00+09:00").getTime() / 1000;
  const time = [], weather_code = [], precipitation_probability = [], temperature_2m = [];
  for (let i = 0; i < 16 * 24; i++) {
    const t = start + i * 3600;
    time.push(t);
    weather_code.push(t === rainy ? 61 : 1);
    precipitation_probability.push(t === rainy ? 70 : 10);
    temperature_2m.push(t === rainy ? 15 : 12);
  }
  return { hourly: { time, weather_code, precipitation_probability, temperature_2m } };
}

function setup(o = {}) {
  const asked = [];
  const gas = makeGas({
    now: "2026-11-10T08:00:00+09:00",
    plans: [
      planRow("2026-11-12", "19:00", "21:00", "灘崎総合公園", "⚽フットサル", "②"),
      planRow("2026-11-13", "10:00", "", "岡南体育館", "練習", ""),
      planRow("2026-11-30", "10:00", "12:00", "灘崎総合公園", "⚽フットサル", ""), // 近くない（天気は出さない）
    ],
    properties: o.properties,
    fetch: (url) => {
      if (!/open-meteo/.test(url)) return undefined;
      asked.push(url);
      return o.down ? response(503, {}) : response(200, forecast());
    },
  });
  const cards = () => JSON.stringify(plain(gas.call("handleTextMessage", event("#今後の予定"))));
  return { gas, asked, cards };
}

test("天気：予定の場所の位置で、開始〜終了の時間の天気（いちばん悪い天気・降水確率・気温の幅）", () => {
  const { asked, cards } = setup();
  const text = cards();
  assert.match(text, /天気: ☔雨 降水70% 12〜15℃/); // 11/12 19-21時（20時が雨）
  assert.match(text, /天気: ⛅晴れ 降水10% 12℃/); // 11/13 10時〜（終了がなければ2時間）
  assert.equal((text.match(/天気: /g) || []).length, 2); // 11/30 は近くないので出さない
  // 灘崎は公園の位置、ほかは岡山市
  assert.ok(asked.some((u) => /latitude=34\.5446&longitude=133\.8679/.test(u)));
  assert.ok(asked.some((u) => /latitude=34\.65&longitude=133\.9333/.test(u)));
  assert.ok(asked.every((u) => /forecast_days=16/.test(u) && !/models=/.test(u)));
});

test("天気：予報は CacheService にしまい、もう一度出すときは聞かない。Script Properties には書かず、前の控えは消す", () => {
  const { gas, asked, cards } = setup({ properties: {
    WEATHER_FORECAST_CACHE_DATE_V1: "2026-11-09",
    WEATHER_FORECAST_CACHE_KEYS_V1: "[]",
    "WEATHER_FORECAST_V1_2026-11-09_abc": "{}",
    WEATHER_GEOCODE_V1_abc: "{}",
    ADMIN_USER_IDS: "U_ADMIN",
  } });
  cards();
  const first = asked.length;
  assert.equal(first, 2);
  cards();
  assert.equal(asked.length, first);
  assert.deepEqual(Object.keys(gas.properties).filter((k) => /^WEATHER_/.test(k)), []);
  assert.equal(gas.properties.ADMIN_USER_IDS, "U_ADMIN"); // ほかの設定は消さない
});

test("天気：読めなくても、カードはそのまま（天気の行がないだけ）", () => {
  const { cards } = setup({ down: true });
  const text = cards();
  assert.match(text, /フットサル/);
  assert.doesNotMatch(text, /天気: /);
});
