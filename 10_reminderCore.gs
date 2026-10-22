// ==========[ 今後の予定の読み取り・リマインド判定・テキスト文面 ]==========
//
// 予定の取得（12_upcomingRecordsCache.gs のキャッシュ → なければ Plan シート）と、
// 自動リマインドの送信判定・送信済みの記録、テキストの文面づくりを持つ。

// ==========[ Error message ]==========
const SHEET_ERROR_TEXT = `🚨エラーが発生しました。\n⚠️シートを確認してね。\n${SETTING.SheetLink}`;

const errorMessage = [{
  type: 'text',
  text: SHEET_ERROR_TEXT,
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

const AUTO_REMINDER_SENT_CACHE_CONFIG = {
  propertyKey: "AUTO_REMINDER_NEAR_SENT_V1",
  retentionDays: 60
};

const MS_PER_HOUR_ = 60 * 60 * 1000;
const MS_PER_DAY_ = 24 * MS_PER_HOUR_;

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
  return Math.floor((startOfDay_(targetDate).getTime() - startOfDay_(baseDate).getTime()) / MS_PER_DAY_);
}

/** 今日から nearTermDays 日後までの予定か（「もうすぐ」の判定） */
function isNearTermDate_(date, now, nearTermDays) {
  const diffDays = diffDaysFromToday_(date, now);
  return diffDays >= 0 && diffDays <= nearTermDays;
}

function scriptTimeZone_() {
  return Session.getScriptTimeZone ? Session.getScriptTimeZone() : "Asia/Tokyo";
}

function buildMonthLabel_(date) {
  return `${date.getMonth() + 1}月`;
}

function findFirstLink_(records) {
  const recordWithLink = records.find(record => record.link);
  return recordWithLink ? recordWithLink.link : "";
}

function formatGoogleCalendarDateTime_(date) {
  return Utilities.formatDate(date, scriptTimeZone_(), "yyyyMMdd'T'HHmmss");
}

function createGoogleCalendarUrl_(record) {
  if (!record || !record.date || !record.endDate) return "";

  const params = [
    "action=TEMPLATE",
    `text=${encodeURIComponent(record.memo1 || "予定")}`,
    `dates=${encodeURIComponent(`${formatGoogleCalendarDateTime_(record.date)}/${formatGoogleCalendarDateTime_(record.endDate)}`)}`,
    `location=${encodeURIComponent(record.place || "")}`,
    `details=${encodeURIComponent(record.memo2 || "")}`,
    `ctz=${encodeURIComponent(scriptTimeZone_())}`
  ];

  return `https://calendar.google.com/calendar/render?${params.join("&")}`;
}

function buildYearMonthKey_(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function buildReminderRecordKey_(record) {
  return [
    _formatDate_(record.date, "yyyy-MM-dd"),
    _formatDate_(record.date, "HH:mm"),
    _formatDate_(record.endDate || record.date, "HH:mm"),
    String(record.memo1 || "").trim(),
    String(record.place || "").trim(),
    String(record.memo2 || "").trim()
  ].join("__");
}

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

function buildRecordDateTime_(dateObj, timeObj) {
  const dateTime = new Date(dateObj);
  dateTime.setHours(timeObj.getHours(), timeObj.getMinutes(), 0, 0);
  return dateTime;
}

function createMessage() {
  Log.start();
  const records = extractUpcomingRecordsWithDateObjects();

  if (!records.length) return errorMessage;

  const messageText = buildReminderTextMessageTextFromRecords_(records);
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

function buildReminderTextMessageTextFromRecords_(records) {
  if (!records.length) return "";

  const merged = mergeRecordsWithinReminderWindow_(records);
  if (!merged.length) return "";

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

  return messageLines.join('\n');
}

/**
 * 通知の文面に入れる予定: 直近の予定（先頭）から、RemindNum 日以内（日付で数える）の予定。
 * 通知の対象（getReminderTargetRecords_）は、今日から RemindNum 日後までなので、必ずこの範囲に入る。
 */
function mergeRecordsWithinReminderWindow_(records) {
  if (!records.length) return [];

  const first = records[0];
  const merged = [first];

  for (let i = 1; i < records.length; i++) {
    const next = records[i];
    const diffDays = diffDaysFromToday_(next.date, first.date);

    if (diffDays <= SETTING.RemindNum) {
      merged.push(next);
      continue;
    }

    break;
  }

  return merged;
}

function extractUpcomingRecordsWithDateObjects(forceRefresh) {
  Log.start();
  const cachedRecords = loadCachedUpcomingRecords_(forceRefresh);
  if (cachedRecords) {
    Log.finish({ result: cachedRecords });
    return cachedRecords;
  }

  const result = readUpcomingRecordsFromSheet_();
  saveCachedUpcomingRecords_(result);

  Log.finish({ result });
  return result;
}

/**
 * 通知する予定: 今日から RemindNum 日後までの予定のうち、まだ通知していないもの。
 *
 * 「ちょうど RemindNum 日後」だけを対象にすると、定期実行が1日動かなかったときや、
 * 直前に追加した予定が、一度も通知されない。そのため、期間（今日〜RemindNum 日後）で拾い直す。
 * 同じ予定を何度も通知しないよう、通知済みの予定は送信済みの記録（completeAutoReminderSend）で除く。
 */
function getReminderTargetRecords_(records, now) {
  const baseNow = now || new Date();
  // 設定の日数が数字でないとき（シートの設定が空など）は、全件を通知してしまわないよう、何も通知しない
  if (!(SETTING.RemindNum >= 0)) {
    return [];
  }

  const sentRecordKeyMap = loadAutoReminderSentKeyMap_();

  return records.filter(record => {
    const diffDays = diffDaysFromToday_(record.date, baseNow);
    if (diffDays < 0 || diffDays > SETTING.RemindNum) {
      return false;
    }

    return !sentRecordKeyMap[buildReminderRecordKey_(record)];
  });
}

function createAutoReminderSenderName() {
  const records = extractUpcomingRecordsWithDateObjects();
  const targetRecords = getReminderTargetRecords_(records, new Date());
  return buildAutoReminderSenderNameFromRecords_(targetRecords);
}

function buildAutoReminderSenderNameFromRecords_(records) {
  if (!Array.isArray(records) || !records.length) {
    return "対象日:";
  }

  const dateLabels = Array.from(new Set(records.map(record => _formatDate_(record.date, "M/d"))));
  return `対象日: ${dateLabels.join(", ")}`;
}

function shouldSendRemindMessage() {
  Log.start();
  const records = extractUpcomingRecordsWithDateObjects();
  if (records.length === 0) return false;

  const targetRecords = getReminderTargetRecords_(records, new Date());
  Log.debug(`targetRecordCount=${targetRecords.length}`);

  Log.finish();
  return targetRecords.length > 0;
}

function createAutoReminderMessages() {
  return createAutoReminderFlexMessages_();
}

function completeAutoReminderSend() {
  const records = extractUpcomingRecordsWithDateObjects();
  markAutoReminderRecordsAsSent_(records);
}

function loadAutoReminderSentKeyMap_() {
  const props = PropertiesService.getScriptProperties();
  const payload = props.getProperty(AUTO_REMINDER_SENT_CACHE_CONFIG.propertyKey);
  if (!payload) {
    return {};
  }

  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return cleanupAutoReminderSentKeyMap_(parsed, false);
  } catch (err) {
    Log.debug(`⚠️ auto reminder sent cache parse failed: ${err.message}`);
    return {};
  }
}

function cleanupAutoReminderSentKeyMap_(sentKeyMap, shouldPersist) {
  const today = startOfDay_(new Date());
  const retentionMs = AUTO_REMINDER_SENT_CACHE_CONFIG.retentionDays * MS_PER_DAY_;
  const cleaned = {};

  Object.keys(sentKeyMap || {}).forEach(key => {
    const notifiedAt = new Date(sentKeyMap[key]);
    if (!isValidDate(notifiedAt)) {
      return;
    }

    if (today.getTime() - startOfDay_(notifiedAt).getTime() <= retentionMs) {
      cleaned[key] = sentKeyMap[key];
    }
  });

  if (shouldPersist) {
    PropertiesService.getScriptProperties().setProperty(
      AUTO_REMINDER_SENT_CACHE_CONFIG.propertyKey,
      JSON.stringify(cleaned)
    );
  }

  return cleaned;
}

/**
 * 通知した予定を、送信済みにする。対象は、通知の文面に入れた予定（mergeRecordsWithinReminderWindow_）。
 * 文面に入れた予定は、次の実行で、もう一度通知されないようにする。
 * （以前は「今日から5日以内」を一律に送信済みにしていて、文面の範囲とずれ、近い日の予定が2回通知されていた）
 */
function markAutoReminderRecordsAsSent_(records) {
  const sentKeyMap = loadAutoReminderSentKeyMap_(); // 読み込み時に古い記録は消してある
  const notifiedAt = new Date().toISOString();

  mergeRecordsWithinReminderWindow_(records).forEach(record => {
    sentKeyMap[buildReminderRecordKey_(record)] = notifiedAt;
  });

  cleanupAutoReminderSentKeyMap_(sentKeyMap, true);
}

function main() {
  Log.start();
  const records = extractUpcomingRecordsWithDateObjects();
  const targetRecords = getReminderTargetRecords_(records, new Date());

  if (targetRecords.length > 0) {
    const messages = createAutoReminderMessages();
    if (messages) {
      Log.debug("Flexリマインド送信");
      // LineApiDriver.PostAllMessages(GROUP_ID, messages);
      // LineApiDriver.reply(messages);
      completeAutoReminderSend();
    }
  } else {
    Log.debug("⏭️ リマインド対象日ではないためスキップ");
  }
  Log.finish();
}
