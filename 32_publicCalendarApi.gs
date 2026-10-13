// ==========[ 公開カレンダー用 API: 今月以降の予定の読み取り専用 JSON ]==========
//
// calendar.html（ログイン不要・リンクを知っている人だけが見る想定）から GET ?action=plans で呼ばれる。
// 日時・場所・内容・補足と、回答リンク（月の共通リンク／予定ごとのリンク）を返す。
//
// キャッシュ方針: Plan シートが更新されたときだけ作り直す。
// - 予定を書き込む処理（管理ページ・#予定確定・シートの手編集）が「更新バージョン」を進める
// - 公開 API はバージョン入りのキーでキャッシュする（バージョンが変われば別キー＝作り直し）
// - 親プロジェクトから呼ばれた書き込みでも無効化できるよう、バージョンはスプレッドシート自身
//   （ドキュメント公開範囲のメタデータ）に持つ。ライブラリ側の CacheService は呼び出し元のものになるため
// - 手編集の検知用トリガーを入れ忘れても古いままにならないよう、保険として有効期限も付ける

const PUBLIC_CALENDAR_CONFIG = {
  cachePrefix: "PUBLIC_CALENDAR_PLANS_V2_",
  cacheSeconds: 60 * 60,
  versionMetadataKey: "plan_version"
};

function createPublicCalendarResponse_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = buildPublicCalendarCacheKey_();
  let payload = cache.get(cacheKey);

  if (!payload) {
    payload = JSON.stringify({ ok: true, records: listPublicPlanRecords_() });
    try {
      cache.put(cacheKey, payload, PUBLIC_CALENDAR_CONFIG.cacheSeconds);
    } catch (err) {
      // 100KB を超えるなどで保存できなくても、そのまま返す
      Log.debug(`⚠️ public calendar cache put failed: ${err.message}`);
    }
  }

  return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JSON);
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

/** スプレッドシートが変更されたとき（人の手編集・行の挿入削除など）に動く。スクリプトからの書き込みでは動かない */
function onPlanSheetChanged() {
  bumpPlanVersion_();
}

/** 一度だけ GAS エディタで実行する。手編集を検知するトリガーを作る（何度実行しても1つだけになる） */
function installPlanChangeTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (trigger) { return trigger.getHandlerFunction() === "onPlanSheetChanged"; })
    .forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });

  ScriptApp.newTrigger("onPlanSheetChanged").forSpreadsheet(SHEET_ID).onChange().create();
}
