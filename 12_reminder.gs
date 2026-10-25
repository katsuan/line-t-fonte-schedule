// ==========[ 自動リマインド：だれに・いつ・何を知らせるか ]==========
//
// - 通知する予定：今日から RemindNum 日後（Setting!B2）までで、まだ通知していないもの（getReminderTargetRecords_）
// - 通知の文面に入れた予定を、送信済みにする（markAutoReminderRecordsAsSent_。60日で消える）
// - 文のリマインドの文面（buildReminderTextMessageTextFromRecords_）
// 入口（01_）の shouldSendRemindMessage・completeAutoReminderSend などから使う

// ==========[ Error message ]==========
const SHEET_ERROR_TEXT = `🚨エラーが発生しました。\n⚠️シートを確認してね。\n${SETTING.SheetLink}`;

/** 予定が1件もないときの、文のリマインド（createMessage）の返事 */
const errorMessage = [{
  type: 'text',
  text: SHEET_ERROR_TEXT,
  sender: SENDERS.Error,
  quickReply: { items: [ACTIONS.SS, ACTIONS.Plan] }
}];

/** リマインドの文面の、見出し・書き出し・しめの候補（毎回1つ選ぶ） */
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

/** 通知済みの予定の記録（Script Properties）のキーと、残す日数 */
const AUTO_REMINDER_SENT_CACHE_CONFIG = {
  propertyKey: "AUTO_REMINDER_NEAR_SENT_V1",
  retentionDays: 60
};

// ---------- 通知する予定 ----------

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

/** 通知済みの記録に使う、予定ごとのキー（日付・時刻・内容・場所・補足） */
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

/** 「対象日: 11/1, 11/3」の文字を作る */
function buildAutoReminderSenderNameFromRecords_(records) {
  if (!Array.isArray(records) || !records.length) {
    return "対象日:";
  }

  const dateLabels = Array.from(new Set(records.map(record => _formatDate_(record.date, "M/d"))));
  return `対象日: ${dateLabels.join(", ")}`;
}

// ---------- 送信済みの記録 ----------

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

/** 通知済みの記録を読む（古いものは除く。書きこまない） */
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

/** 通知済みの記録から、残す日数より古いものを除く。shouldPersist なら保存もする */
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

// ---------- 文面 ----------

/** リマインドの文面（テキスト）を作る。予定がなければ空文字 */
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

/** 並びから1つを選ぶ */
function _pickRandom_(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
