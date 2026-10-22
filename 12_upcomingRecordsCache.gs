// ==========[ 今後の予定のキャッシュ（Script Properties に月ごとに保存し、日付が変わったら作り直す） ]==========
//
// - 1回の呼び出しの中では、メモリ上のものを使い回す
// - Script Properties は1件あたりの大きさに上限があるので、月ごとに分けて保存する

const UPCOMING_RECORDS_CACHE_CONFIG = {
  dateKey: "UPCOMING_RECORDS_CACHE_DATE_V1",
  monthIndexKey: "UPCOMING_RECORDS_CACHE_MONTH_INDEX_V1",
  monthPayloadPrefix: "UPCOMING_RECORDS_CACHE_MONTH_V1_",
  maxPayloadBytesPerMonth: 40 * 1024,
  maxMonthCaches: 12
};

let upcomingRecordsMemoryCache_ = null;
let upcomingRecordsMemoryCacheDate_ = "";

function getTodayCacheKey_() {
  return Utilities.formatDate(new Date(), scriptTimeZone_(), "yyyy-MM-dd");
}

function serializeUpcomingRecords_(records) {
  return JSON.stringify(records.map(record => ({
    dateMs: record.date.getTime(),
    endDateMs: record.endDate.getTime(),
    startMs: record.start.getTime(),
    endMs: record.end.getTime(),
    formatted: record.formatted,
    place: record.place || "",
    memo1: record.memo1 || "",
    memo2: record.memo2 || "",
    link: record.link || ""
  })));
}

function deserializeUpcomingRecords_(payload) {
  const parsed = JSON.parse(payload);
  if (!Array.isArray(parsed)) return [];

  return parsed.map(item => ({
    date: new Date(item.dateMs),
    endDate: new Date(item.endDateMs),
    start: new Date(item.startMs),
    end: new Date(item.endMs),
    formatted: item.formatted || {},
    place: item.place || "",
    memo1: item.memo1 || "",
    memo2: item.memo2 || "",
    link: item.link || ""
  }));
}

function buildMonthPayloadPropertyKey_(monthKey) {
  return `${UPCOMING_RECORDS_CACHE_CONFIG.monthPayloadPrefix}${monthKey}`;
}

function groupUpcomingRecordsByMonth_(records) {
  const grouped = new Map();

  records.forEach(record => {
    const monthKey = buildYearMonthKey_(record.date);
    if (!grouped.has(monthKey)) {
      grouped.set(monthKey, []);
    }
    grouped.get(monthKey).push(record);
  });

  return Array.from(grouped.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, UPCOMING_RECORDS_CACHE_CONFIG.maxMonthCaches);
}

function loadCachedUpcomingRecords_(forceRefresh) {
  if (forceRefresh) {
    return null;
  }

  const todayKey = getTodayCacheKey_();

  if (upcomingRecordsMemoryCache_ && upcomingRecordsMemoryCacheDate_ === todayKey) {
    Log.debug("📦 memory cache hit");
    return upcomingRecordsMemoryCache_;
  }

  const props = PropertiesService.getScriptProperties();
  const cachedDate = props.getProperty(UPCOMING_RECORDS_CACHE_CONFIG.dateKey);
  const monthIndexPayload = props.getProperty(UPCOMING_RECORDS_CACHE_CONFIG.monthIndexKey);

  if (cachedDate !== todayKey || !monthIndexPayload) {
    return null;
  }

  try {
    const monthKeys = JSON.parse(monthIndexPayload);
    if (!Array.isArray(monthKeys) || !monthKeys.length) {
      return [];
    }

    const records = monthKeys.flatMap(monthKey => {
      const monthPayload = props.getProperty(buildMonthPayloadPropertyKey_(monthKey));
      return monthPayload ? deserializeUpcomingRecords_(monthPayload) : [];
    });

    upcomingRecordsMemoryCache_ = records;
    upcomingRecordsMemoryCacheDate_ = todayKey;
    Log.debug("📦 script properties cache hit");
    return records;
  } catch (err) {
    Log.debug("⚠️ cache parse failed. refresh from sheet.");
    return null;
  }
}

function saveCachedUpcomingRecords_(records) {
  const todayKey = getTodayCacheKey_();
  const props = PropertiesService.getScriptProperties();
  const previousMonthIndexPayload = props.getProperty(UPCOMING_RECORDS_CACHE_CONFIG.monthIndexKey);
  const previousMonthKeys = previousMonthIndexPayload ? JSON.parse(previousMonthIndexPayload) : [];
  const groupedEntries = groupUpcomingRecordsByMonth_(records);
  const nextMonthKeys = [];
  const propertiesToSave = {
    [UPCOMING_RECORDS_CACHE_CONFIG.dateKey]: todayKey
  };

  groupedEntries.forEach(([monthKey, monthRecords]) => {
    const payload = serializeUpcomingRecords_(monthRecords);
    const payloadBytes = Utilities.newBlob(payload).getBytes().length;

    if (payloadBytes > UPCOMING_RECORDS_CACHE_CONFIG.maxPayloadBytesPerMonth) {
      Log.debug(`⚠️ skip oversized month cache ${monthKey}: ${payloadBytes} bytes`);
      return;
    }

    nextMonthKeys.push(monthKey);
    propertiesToSave[buildMonthPayloadPropertyKey_(monthKey)] = payload;
  });

  propertiesToSave[UPCOMING_RECORDS_CACHE_CONFIG.monthIndexKey] = JSON.stringify(nextMonthKeys);
  props.setProperties(propertiesToSave);

  previousMonthKeys
    .filter(monthKey => !nextMonthKeys.includes(monthKey))
    .forEach(monthKey => props.deleteProperty(buildMonthPayloadPropertyKey_(monthKey)));

  upcomingRecordsMemoryCache_ = records;
  upcomingRecordsMemoryCacheDate_ = todayKey;
}
