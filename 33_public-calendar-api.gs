// ==========[ 公開カレンダーの API（doGet ?action=plans）と、予定の版 ]==========
//
// calendar.html（ログイン不要）に、今月からの予定と、同期先カレンダーの登録リンクを返す。
// - 登録リンクは、専用カレンダー（@group.calendar.google.com）のときだけ（個人のメールアドレスが読めてしまうため）
// - 返事は「予定の版」をキーに控える。予定を書く処理が版を進める（bumpPlanVersion_）。
//   版はスプレッドシート自身（ドキュメントのメタデータ）に持つので、親から呼ばれた書きこみでも進められる
// - 手で直したときは onPlanSheetChanged（トリガー）が版を進める。入れ忘れても1時間で作り直す

/** 公開カレンダーの控えのキー・時間と、版の印の名前 */
const PUBLIC_CALENDAR_CONFIG = {
  cachePrefix: "PUBLIC_CALENDAR_PLANS_V3_",
  cacheSeconds: 60 * 60,
  versionMetadataKey: "plan_version"
};

/** 公開カレンダーの返事（今月からの予定と、カレンダーの登録リンク） */
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

/**
 * 今月1日以降の予定を、公開してよい項目だけに絞って返す（今月の過ぎた日も含める）。
 */
function listPublicPlanRecords_() {
  const monthStart = `${_formatDate_(new Date(), "yyyy-MM")}-01`;

  return listPlanRecords_()
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

/** 月が変わったら別キーになるよう、年月と更新バージョンをキーに含める */
function buildPublicCalendarCacheKey_() {
  return `${PUBLIC_CALENDAR_CONFIG.cachePrefix}${_formatDate_(new Date(), "yyyy-MM")}_${getPlanVersion_()}`;
}

/**
 * 同期先カレンダーを、閲覧者が自分の Google カレンダーに登録するためのリンク。
 * 専用カレンダーでないとき（メールアドレスが読み取れてしまうとき）や、未設定のときは空文字を返す。
 */
function buildCalendarSubscribeUrl_() {
  const calendarId = getCalendarSyncId_();
  if (!isDedicatedCalendarId_(calendarId)) return "";

  const cid = Utilities.base64Encode(calendarId, Utilities.Charset.UTF_8).replace(/=+$/, "");
  return `https://calendar.google.com/calendar/u/0?cid=${encodeURIComponent(cid)}`;
}

/** 専用カレンダー（@group.calendar.google.com など）のID。メールアドレス形式のID（個人のメインカレンダー）は含めない */
function isDedicatedCalendarId_(calendarId) {
  return /^[^@\s]+@(group|import)\.calendar\.google\.com$/i.test(calendarId || "");
}

// ---------- 予定の版 ----------

/** 同じ呼び出しの中では1回だけ読む（bumpPlanVersion_ で進めたら読み直す） */
function getPlanVersion_() {
  return memo_("planVersion", function () {
    try {
      const found = findPlanVersionMetadata_();
      return found.length ? found[0].getValue() : "0";
    } catch (err) {
      Log.debug(`⚠️ plan version read failed: ${err.message}`);
      return "0";
    }
  });
}

/**
 * Plan シートを書き換えたら呼ぶ。失敗しても、書き込み自体は成功扱いにする（古いキャッシュが残るだけ）。
 * 親プロジェクトから呼ばれても読めるよう、公開範囲は DOCUMENT にする（既定の PROJECT だと呼び出し元ごとに見えない）。
 */
function bumpPlanVersion_() {
  forgetMemo_("planVersion");
  try {
    const value = String(Date.now());
    const found = findPlanVersionMetadata_();
    if (found.length) {
      found[0].setValue(value); // qcheck-ok: G1 シートではなく版の印（数字）
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

/** スプレッドシートに持たせた版の印を探す */
function findPlanVersionMetadata_() {
  return ss.createDeveloperMetadataFinder()
    .withKey(PUBLIC_CALENDAR_CONFIG.versionMetadataKey)
    .withLocationType(SpreadsheetApp.DeveloperMetadataLocationType.SPREADSHEET)
    .find();
}
