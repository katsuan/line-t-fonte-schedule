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
  payloadKey: "UPCOMING_RECORDS_CACHE_PAYLOAD_V1",
  maxPayloadBytes: 450 * 1024
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

function loadCachedUpcomingRecords_() {
  const todayKey = getTodayCacheKey_();

  if (upcomingRecordsMemoryCache_ && upcomingRecordsMemoryCacheDate_ === todayKey) {
    Log.debug("📦 memory cache hit");
    return upcomingRecordsMemoryCache_;
  }

  const props = PropertiesService.getScriptProperties();
  const cachedDate = props.getProperty(UPCOMING_RECORDS_CACHE_CONFIG.dateKey);
  const cachedPayload = props.getProperty(UPCOMING_RECORDS_CACHE_CONFIG.payloadKey);

  if (cachedDate !== todayKey || !cachedPayload) {
    return null;
  }

  try {
    const records = deserializeUpcomingRecords_(cachedPayload);
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
  const payload = serializeUpcomingRecords_(records);
  const payloadBytes = Utilities.newBlob(payload).getBytes().length;

  if (payloadBytes > UPCOMING_RECORDS_CACHE_CONFIG.maxPayloadBytes) {
    Log.debug(`⚠️ cache payload too large for script properties: ${payloadBytes} bytes`);
    upcomingRecordsMemoryCache_ = records;
    upcomingRecordsMemoryCacheDate_ = todayKey;
    return;
  }

  props.setProperties({
    [UPCOMING_RECORDS_CACHE_CONFIG.dateKey]: todayKey,
    [UPCOMING_RECORDS_CACHE_CONFIG.payloadKey]: payload
  });

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
