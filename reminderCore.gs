// ==========[ Error message ]==========
const errorMessage = [{
  type: 'text',
  text: `🚨エラーが発生しました。\n⚠️シートを確認してね。\n${SETTING.SheetLink}`,
  sender: SENDERS.Error,
  quickReply: { items: [ACTIONS.SS, ACTIONS.Plan] }
}];

const RANDOM_TEXTS = {
  title: [
    "🗓️ 活動日リマインド",
    "⏰ そろそろ活動日です！",
    "🔥 次の予定のお知らせ",
    "👀 予定チェックお願いします",
    "🎯 直近スケジュール共有"
  ],
  intro: [
    "直近の予定はこちらです👇",
    "以下の日程が近づいています！",
    "出欠チェックお願いします🙏",
    "スケジュールご確認ください✨",
  ],
  closing: [
    "回答まだの方、よろしくお願いします！",
    "忘れてた人いませんか？👀"
  ]
};

const UPCOMING_RECORDS_CACHE_CONFIG = {
  dateKey: "UPCOMING_RECORDS_CACHE_DATE_V1",
  monthIndexKey: "UPCOMING_RECORDS_CACHE_MONTH_INDEX_V1",
  monthPayloadPrefix: "UPCOMING_RECORDS_CACHE_MONTH_V1_",
  maxPayloadBytesPerMonth: 40 * 1024,
  maxMonthCaches: 12
};

let upcomingRecordsMemoryCache_ = null;
let upcomingRecordsMemoryCacheDate_ = "";

// ==========[ Utility ]==========

function isValidDate(d) {
  return Object.prototype.toString.call(d) === "[object Date]" && !isNaN(d);
}

function _pickRandom_(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function startOfDay_(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function diffDaysFromToday_(targetDate, baseDate) {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((startOfDay_(targetDate).getTime() - startOfDay_(baseDate).getTime()) / msPerDay);
}

function isSameYearMonth_(date, targetYear, targetMonthIndex) {
  return date.getFullYear() === targetYear && date.getMonth() === targetMonthIndex;
}

function buildMonthLabel_(date) {
  return `${date.getMonth() + 1}月`;
}

function findFirstLink_(records) {
  const recordWithLink = records.find(record => record.link);
  return recordWithLink ? recordWithLink.link : "";
}

function formatGoogleCalendarDateTime_(date) {
  const timezone = Session.getScriptTimeZone ? Session.getScriptTimeZone() : "Asia/Tokyo";
  return Utilities.formatDate(date, timezone, "yyyyMMdd'T'HHmmss");
}

function createGoogleCalendarUrl_(record) {
  if (!record || !record.date || !record.endDate) return "";

  const params = [
    "action=TEMPLATE",
    `text=${encodeURIComponent(record.memo1 || "予定")}`,
    `dates=${encodeURIComponent(`${formatGoogleCalendarDateTime_(record.date)}/${formatGoogleCalendarDateTime_(record.endDate)}`)}`,
    `location=${encodeURIComponent(record.place || "")}`,
    `details=${encodeURIComponent(record.memo2 || "")}`,
    `ctz=${encodeURIComponent(Session.getScriptTimeZone ? Session.getScriptTimeZone() : "Asia/Tokyo")}`
  ];

  return `https://calendar.google.com/calendar/render?${params.join("&")}`;
}

function buildYearMonthKey_(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getTodayCacheKey_() {
  const timezone = Session.getScriptTimeZone ? Session.getScriptTimeZone() : "Asia/Tokyo";
  return Utilities.formatDate(new Date(), timezone, "yyyy-MM-dd");
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

function loadCachedUpcomingRecords_() {
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

function readUpcomingRecordsFromSheet_() {
  const values = SHEETS.Plan.getDataRange().getValues();
  const dataRows = values.slice(1);
  const now = new Date();

  const result = [];

  for (const row of dataRows) {
    const [dateObj, startObj, endObj, place, memo1, memo2, link] = row;
    const safeEndObj = isValidDate(endObj) ? endObj : startObj;

    if (!isValidDate(dateObj) || !isValidDate(startObj)) {
      Log.debug("⚠️ date or start invalid. skip.");
      continue;
    }

    const dateTime = new Date(dateObj);
    dateTime.setHours(startObj.getHours(), startObj.getMinutes(), 0, 0);
    const endDateTime = new Date(dateObj);
    endDateTime.setHours(safeEndObj.getHours(), safeEndObj.getMinutes(), 0, 0);

    if (dateTime >= now) {
      Log.debug("✅ 未来の予定ヒット！");
      result.push({
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
      });
    }
  }

  result.sort((a, b) => a.date - b.date);
  return result;
}

function createMessage() {
  Log.start();
  const records = extractUpcomingRecordsWithDateObjects();

  if (!records.length) return errorMessage;

  const merged = mergeRecordsWithinReminderWindow_(records);
  const first = merged[0];
  const randomTitle = _pickRandom_(RANDOM_TEXTS.title);
  const randomIntro = _pickRandom_(RANDOM_TEXTS.intro);
  const randomClosing = _pickRandom_(RANDOM_TEXTS.closing);

  const messageLines = [
    randomTitle,
    randomIntro,
  ];

  for (const record of merged) {
    messageLines.push(`${record.memo1}`);
    messageLines.push(`　${record.formatted.date} ${record.formatted.start}-${record.formatted.end}`);
    messageLines.push(`　${record.place}${record.memo2}`);
  }

  messageLines.push(randomClosing);

  if (first.link) {
    messageLines.push(first.link);
  }

  const messageText = messageLines.join('\n');
  const actions = [ACTIONS.FlexSender, ACTIONS.Copy(messageText), ACTIONS.SS, ACTIONS.Plan];

  console.log(messageText);

  Log.finish();

  return [{
    type: 'text',
    text: messageText,
    sender: SENDERS.Auto,
    quickReply: { items: actions }
  }];
}

function mergeRecordsWithinReminderWindow_(records) {
  if (!records.length) return [];

  const first = records[0];
  const merged = [first];

  for (let i = 1; i < records.length; i++) {
    const next = records[i];
    const diffMs = next.date.getTime() - first.date.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffDays <= SETTING.RemindNum) {
      merged.push(next);
      continue;
    }

    break;
  }

  return merged;
}

function extractUpcomingRecordsWithDateObjects() {
  Log.start();
  const cachedRecords = loadCachedUpcomingRecords_();
  if (cachedRecords) {
    Log.finish({ result: cachedRecords });
    return cachedRecords;
  }

  const result = readUpcomingRecordsFromSheet_();
  saveCachedUpcomingRecords_(result);

  Log.finish({ result });
  return result;
}

function shouldSendRemindMessage() {
  Log.start();
  const records = extractUpcomingRecordsWithDateObjects();
  if (records.length === 0) return false;

  const now = new Date();
  const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + SETTING.RemindNum);
  const targetYMD = _formatDate_(targetDate, "yyyy-MM-dd");
  Log.debug('targetYMD' + targetYMD);

  Log.finish();

  return records.some(record => {
    const recordYMD = _formatDate_(record.date, "yyyy-MM-dd");
    Log.debug('recordYMD' + recordYMD);
    return recordYMD === targetYMD;
  });
}

function main() {
  Log.start();
  if (shouldSendRemindMessage()) {
    const messages = createMessage();
    if (messages) {
      Log.debug("任意の送信処理");
      // LineApiDriver.PostAllMessages(GROUP_ID, messages);
      // LineApiDriver.reply(messages);
    }
  } else {
    Log.debug("⏭️ リマインド対象日ではないためスキップ");
  }
  Log.finish();
}
