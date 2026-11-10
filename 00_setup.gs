// ==========[ 人が実行する関数と、人が書きかえる設定 ]==========
//
// GAS エディタの「実行」から動かす関数と、書きかえてよい設定だけを置く。
//
// どの順に何を実行するか:
//   1. runSelfCheck              … いつでも。設定・シート・通知・カレンダー同期・トリガーのようすを実行ログに出す（書きこまない）
//   はじめの準備（それぞれ一度だけ）:
//   2. authorizeCalendarSync     … Script Property `CALENDAR_ID` を入れてから。カレンダーの権限を承認し、開けるか確かめる
//   3. installCalendarSyncTrigger … 1日1回の Google カレンダー同期のトリガーを作る
//   4. installPlanChangeTrigger  … シートを手で直したときに、公開カレンダーとカレンダー同期に反映するトリガーを作る
//
// Script Properties: SHEET_ID（予定のシート）・GROUP_ID・ADMIN_USER_IDS（管理者の userId をカンマ区切り）・OWNER_USER_IDS（サイト作成者。管理者の申請を承認できる）・CALENDAR_ID（同期先）
// このプロジェクトは、親の LINE ボットからライブラリ（開発モード）として読まれる。clasp push するとすぐ親に反映される

// ---------- 人が実行する関数 ----------

/**
 * 自己点検。いつ実行してもよい（何も書きこまない）。
 * 実行ログに、シート・通知の日数・次の通知・管理者・カレンダー同期・トリガーのようすを ✅⚠️❌ で出す（LINE の「#テスト 点検」と同じ中身）
 */
function runSelfCheck() {
  collectAdminSelfChecks_().forEach(function (check) {
    console.log(`${selfCheckMark_(check.level)} ${check.label}: ${check.value}`);
  });
}

/**
 * 最初に一度だけ GAS エディタで実行する。カレンダーを扱う権限の承認画面を出し、カレンダーを開けるか確かめる。
 * 実行ログに、カレンダー名が出れば OK。
 */
function authorizeCalendarSync() {
  const calendarId = getCalendarSyncId_();
  if (!calendarId) throw new Error("先に Script Property CALENDAR_ID にカレンダーIDを入れてください。");

  const calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) throw new Error("カレンダーを開けません。IDと共有設定（この Google アカウントに「予定の変更」権限）を確認してください。");
  console.log(`OK: ${calendar.getName()}`);
}

/** 一度だけ GAS エディタで実行する。1日1回の定期トリガーを作る（何度実行しても1つだけになる） */
function installCalendarSyncTrigger() {
  replaceProjectTrigger_("syncPlansToCalendarJob", function (builder) {
    return builder.timeBased().everyDays(1).atHour(CALENDAR_SYNC_CONFIG.triggerHour);
  });
}

/** 一度だけ GAS エディタで実行する。手編集を検知するトリガーを作る（何度実行しても1つだけになる） */
function installPlanChangeTrigger() {
  replaceProjectTrigger_("onPlanSheetChanged", function (builder) {
    return builder.forSpreadsheet(SHEET_ID).onChange();
  });
}

// ---------- 人が書きかえる設定 ----------

/** LIFF の URL（リッチに送る・管理ページ） */
const LIFF_URLS = {
  FlexSender: "https://liff.line.me/2009927582-9QtOstUK",
  // 管理ページ（予定の追加・編集・削除）。LIFF の URL にパスを足すと、エンドポイント配下のそのページが開く
  Admin: "https://liff.line.me/2009927582-9QtOstUK/admin.html"
}

/** 通知カードの「グループへ」で開く LINE グループのリンク */
const GROUP_LINK = "line://ti/g/hwc5nRC7mS"

// 終了時刻が無い予定は、開始の何時間後までとみなすか（管理ページ・まとめて追加・カレンダー同期で共通）
const DEFAULT_PLAN_DURATION_HOURS = 2;

/**
 * 天気（Open-Meteo）の設定。場所の名前で位置を探すと公園などは見つからないので、位置は決めておく（どの予定も岡山市）。
 * 場所ごとに変えたいときは Places に { words, name, latitude, longitude } を足す。予報は予定の時間（開始〜終了）の1時間ごとのものから作る
 */
const WEATHER_CONFIG = {
  Enabled: true, // 天気の取得・表示（止めるときは false）
  TimeZone: "Asia/Tokyo",
  ForecastApiBaseUrl: "https://api.open-meteo.com/v1/forecast",
  // models を付けない（best_match）。日本では気象庁などのモデルをまぜ、16日先まで・降水確率もある
  ForecastDays: 16,
  CacheMinutes: 180, // 予報を CacheService にしまう時間
  CachePrefix: "weather-forecast-v2-",
  Places: [],
  Default: { name: "岡山市", latitude: 34.65, longitude: 133.9333 },
  // 前に Script Properties にしまっていた控え（見つけたら消す）
  OldPropertyPrefixes: ["WEATHER_GEOCODE_V1_", "WEATHER_FORECAST_V1_", "WEATHER_FORECAST_CACHE_DATE_V1", "WEATHER_FORECAST_CACHE_KEYS_V1"]
}
