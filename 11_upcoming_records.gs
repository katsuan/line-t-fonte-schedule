// ==========[ これからの予定（リマインドとカードに使う形）と、その日の控え ]==========
//
// - extractUpcomingRecordsWithDateObjects … これからの予定を日時の順に返す。その日の控えがあれば使う
// - 控えは Script Properties に月ごとに分けて入れ、日付が変わったら作り直す
// リマインド（12_）・カード（30_）・入口（01_）から使う

/** これからの予定（日時の順）。その日の控えがあれば使い、なければシートから読んで控えを作る。forceRefresh なら読み直す */
function extractUpcomingRecordsWithDateObjects(forceRefresh) {
  Log.start();
  const cachedRecords = loadCachedUpcomingRecords_(forceRefresh);
  if (cachedRecords) {
    // 控えはその日の最初に作るので、そのあとに過ぎた今日の予定を除く（シートから読むときと同じ）
    const now = new Date();
    const upcoming = cachedRecords.filter(record => record.date >= now);
    Log.finish({ result: upcoming });
    return upcoming;
  }

  const result = readUpcomingRecordsFromSheet_();
  saveCachedUpcomingRecords_(result);

  Log.finish({ result });
  return result;
}

/** Plan シートから、これからの予定を日時の順に読む（書きこまない） */
function readUpcomingRecordsFromSheet_() {
  const dataRows = readPlanValues_().slice(1);
  const now = new Date();
  const result = dataRows
    .map(function (row) {
      return mapUpcomingRecordRow_(row, now);
    })
    .filter(function (record) {
      return !!record;
    });

  result.sort(function (a, b) {
    return a.date - b.date;
  });
  return result;
}

/** Plan シートの1行を、リマインドに使う予定の形にする（過ぎた予定・日時のない行は null） */
function mapUpcomingRecordRow_(row, now) {
  const [dateObj, startObj, endObj, place, memo1, memo2, link] = row;
  const safeEndObj = isValidDate(endObj) ? endObj : startObj;

  if (!isValidDate(dateObj) || !isValidDate(startObj)) {
    Log.debug("⚠️ date or start invalid. skip.");
    return null;
  }

  const dateTime = buildRecordDateTime_(dateObj, startObj);
  const endDateTime = buildRecordDateTime_(dateObj, safeEndObj);

  if (dateTime < now) {
    return null;
  }

  Log.debug("✅ 未来の予定ヒット！");
  return {
    date: dateTime,
    endDate: endDateTime,
    start: startObj,
    end: safeEndObj,
    formatted: {
      date: _formatDate_(dateTime, FORMAT.Date),
      start: _formatDate_(startObj, FORMAT.Time),
      end: _formatDate_(safeEndObj, FORMAT.Time),
    },
    place,
    memo1,
    memo2,
    link
  };
}

/** 日付のセルと時刻のセルから、日時を作る */
function buildRecordDateTime_(dateObj, timeObj) {
  const dateTime = new Date(dateObj);
  dateTime.setHours(timeObj.getHours(), timeObj.getMinutes(), 0, 0);
  return dateTime;
}

// ---------- その日の控え ----------

/** これからの予定の控え（Script Properties）のキーと大きさの上限 */
const UPCOMING_RECORDS_CACHE_CONFIG = {
  dateKey: "UPCOMING_RECORDS_CACHE_DATE_V1",
  monthIndexKey: "UPCOMING_RECORDS_CACHE_MONTH_INDEX_V1",
  monthPayloadPrefix: "UPCOMING_RECORDS_CACHE_MONTH_V1_",
  maxPayloadBytesPerMonth: 40 * 1024,
  maxMonthCaches: 12
};

/** 1回の呼び出しの中の、これからの予定の控え */
let upcomingRecordsMemoryCache_ = null;

/** upcomingRecordsMemoryCache_ を作った日 */
let upcomingRecordsMemoryCacheDate_ = "";

/** 今日の日付の文字（控えを作った日と比べる） */
function getTodayCacheKey_() {
  return Utilities.formatDate(new Date(), scriptTimeZone_(), "yyyy-MM-dd");
}

/** 今日の控えを読む（メモリ → Script Properties）。なければ null */
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

/** これからの予定を、月ごとに分けて控えに入れる（いらなくなった月の控えは消す） */
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

/** 予定の並びを、控えに入れる文字（JSON）にする */
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

/** 控えの文字（JSON）を、予定の並びに戻す */
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

/** 月ごとの控えのキー */
function buildMonthPayloadPropertyKey_(monthKey) {
  return `${UPCOMING_RECORDS_CACHE_CONFIG.monthPayloadPrefix}${monthKey}`;
}

/** 予定を月ごとに分ける（先の月から決めた数まで） */
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
