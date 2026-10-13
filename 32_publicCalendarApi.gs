// ==========[ 公開カレンダー用 API: 今月以降の予定の読み取り専用 JSON ]==========
//
// calendar.html（ログイン不要・リンクを知っている人だけが見る想定）から GET ?action=plans で呼ばれる。
// 日時・場所・内容・補足と、回答リンク（月の共通リンク／予定ごとのリンク）を返す。
// あわせて、同期先の Google カレンダーを登録するリンク（subscribeUrl）を返す。
// ・リンクの cid はカレンダーIDの base64（元に戻せる）なので、IDがメールアドレス（個人のメインカレンダー）のときは出さない。
//   専用カレンダー（xxx@group.calendar.google.com）のときだけ出す
// ・カレンダーIDはリポジトリに書かず、Script Property `CALENDAR_ID` から作る
//
// キャッシュ方針: Plan シートが更新されたときだけ作り直す。
// - 予定を書き込む処理（管理ページ・#予定確定・シートの手編集）が「更新バージョン」を進める
// - 公開 API はバージョン入りのキーでキャッシュする（バージョンが変われば別キー＝作り直し）
// - 親プロジェクトから呼ばれた書き込みでも無効化できるよう、バージョンはスプレッドシート自身
//   （ドキュメント公開範囲のメタデータ）に持つ。ライブラリ側の CacheService は呼び出し元のものになるため
// - 手編集の検知用トリガーを入れ忘れても古いままにならないよう、保険として有効期限も付ける

const PUBLIC_CALENDAR_CONFIG = {
  cachePrefix: "PUBLIC_CALENDAR_PLANS_V3_",
  cacheSeconds: 60 * 60,
  versionMetadataKey: "plan_version"
};

function createPublicCalendarResponse_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = buildPublicCalendarCacheKey_();
  let recordsJson = cache.get(cacheKey);

  if (!recordsJson) {
    recordsJson = JSON.stringify(listPublicPlanRecords_());
    try {
      cache.put(cacheKey, recordsJson, PUBLIC_CALENDAR_CONFIG.cacheSeconds);
    } catch (err) {
      // 100KB を超えるなどで保存できなくても、そのまま返す
      Log.debug(`⚠️ public calendar cache put failed: ${err.message}`);
    }
  }

  // 予定（キャッシュ済みの JSON）に、登録リンクを足して返す。登録リンクは設定次第で変わるのでキャッシュに入れない
  const payload = `{"ok":true,"records":${recordsJson},"subscribeUrl":${JSON.stringify(buildCalendarSubscribeUrl_())}}`;
  return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JSON);
}

/** 専用カレンダー（@group.calendar.google.com など）のID。メールアドレス形式のID（個人のメインカレンダー）は含めない */
function isDedicatedCalendarId_(calendarId) {
  return /^[^@\s]+@(group|import)\.calendar\.google\.com$/i.test(calendarId || "");
}

/**
 * 同期先カレンダーを、閲覧者が自分の Google カレンダーに登録するためのリンク。
 * 専用カレンダーでないとき（メールアドレスが読み取れてしまうとき）や、未設定のときは空文字を返す。
 */
function buildCalendarSubscribeUrl_() {
  const calendarId = (PropertiesService.getScriptProperties().getProperty(CALENDAR_SYNC_CONFIG.idProperty) || "").trim();
  if (!isDedicatedCalendarId_(calendarId)) return "";

  const cid = Utilities.base64Encode(calendarId, Utilities.Charset.UTF_8).replace(/=+$/, "");
  return `https://calendar.google.com/calendar/u/0?cid=${encodeURIComponent(cid)}`;
}

/** 月が変わったら別キーになるよう、年月と更新バージョンをキーに含める */
function buildPublicCalendarCacheKey_() {
  return `${PUBLIC_CALENDAR_CONFIG.cachePrefix}${_formatDate_(new Date(), "yyyy-MM")}_${getPlanVersion_()}`;
}

/**
 * 今月1日以降の予定を、公開してよい項目だけに絞って返す（今月の過ぎた日も含める）。
 */
function listPublicPlanRecords_() {
  const monthStart = `${_formatDate_(new Date(), "yyyy-MM")}-01`;

  return listAdminPlanRows_()
    .filter(function (record) { return record.date >= monthStart; })
    .map(function (record) {
      return {
        date: record.date,
        start: record.start,
        end: record.end,
        place: record.place,
        memo1: record.memo1,
        memo2: record.memo2,
        link: record.link
      };
    })
    .sort(function (a, b) {
      return (a.date + a.start).localeCompare(b.date + b.start);
    });
}

// ---------- 更新バージョン ----------

function findPlanVersionMetadata_() {
  return ss.createDeveloperMetadataFinder()
    .withKey(PUBLIC_CALENDAR_CONFIG.versionMetadataKey)
    .withLocationType(SpreadsheetApp.DeveloperMetadataLocationType.SPREADSHEET)
    .find();
}

function getPlanVersion_() {
  try {
    const found = findPlanVersionMetadata_();
    return found.length ? found[0].getValue() : "0";
  } catch (err) {
    Log.debug(`⚠️ plan version read failed: ${err.message}`);
    return "0";
  }
}

/**
 * Plan シートを書き換えたら呼ぶ。失敗しても、書き込み自体は成功扱いにする（古いキャッシュが残るだけ）。
 * 親プロジェクトから呼ばれても読めるよう、公開範囲は DOCUMENT にする（既定の PROJECT だと呼び出し元ごとに見えない）。
 */
function bumpPlanVersion_() {
  try {
    const value = String(Date.now());
    const found = findPlanVersionMetadata_();
    if (found.length) {
      found[0].setValue(value);
    } else {
      ss.addDeveloperMetadata(
        PUBLIC_CALENDAR_CONFIG.versionMetadataKey,
        value,
        SpreadsheetApp.DeveloperMetadataVisibility.DOCUMENT
      );
    }
  } catch (err) {
    Log.debug(`⚠️ plan version bump failed: ${err.message}`);
  }
}

// ---------- シートの手編集の検知（インストール型トリガー） ----------

/**
 * スプレッドシートが変更されたとき（人の手編集・行の挿入削除など）に動く。スクリプトからの書き込みでは動かない。
 * 公開カレンダーのキャッシュを作り直すため版を進め、Google カレンダーにもその場で反映する（CALENDAR_ID 未設定なら何もしない）
 */
function onPlanSheetChanged() {
  bumpPlanVersion_();
  syncPlansToCalendarSafely_(false);
}

/** 一度だけ GAS エディタで実行する。手編集を検知するトリガーを作る（何度実行しても1つだけになる） */
function installPlanChangeTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (trigger) { return trigger.getHandlerFunction() === "onPlanSheetChanged"; })
    .forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });

  ScriptApp.newTrigger("onPlanSheetChanged").forSpreadsheet(SHEET_ID).onChange().create();
}
