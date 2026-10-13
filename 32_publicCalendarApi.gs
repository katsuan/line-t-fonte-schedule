// ==========[ 公開カレンダー用 API: 今月以降の予定の読み取り専用 JSON ]==========
//
// calendar.html（ログイン不要・リンクを知っている人だけが見る想定）から GET ?action=plans で呼ばれる。
// 参加リンク（月の共通リンク）などは返さず、日時・場所・内容・補足だけを返す。

const PUBLIC_CALENDAR_CONFIG = {
  cacheKey: "PUBLIC_CALENDAR_PLANS_V1",
  cacheSeconds: 60
};

function createPublicCalendarResponse_() {
  const cache = CacheService.getScriptCache();
  let payload = cache.get(PUBLIC_CALENDAR_CONFIG.cacheKey);

  if (!payload) {
    payload = JSON.stringify({ ok: true, records: listPublicPlanRecords_() });
    cache.put(PUBLIC_CALENDAR_CONFIG.cacheKey, payload, PUBLIC_CALENDAR_CONFIG.cacheSeconds);
  }

  return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JSON);
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
        memo2: record.memo2
      };
    })
    .sort(function (a, b) {
      return (a.date + a.start).localeCompare(b.date + b.start);
    });
}

/** 管理ページで予定を変えたら、公開カレンダーにすぐ反映されるようにキャッシュを捨てる */
function clearPublicCalendarCache_() {
  CacheService.getScriptCache().remove(PUBLIC_CALENDAR_CONFIG.cacheKey);
}
