// ==========[ エラーメッセージ ]==========
const errorMessage = [{
  type: 'text',
  text: `🚨エラーが発生しました。\n⚠️シートを確認してね。\n${SETTING.SheetLink}`,
  sender: SENDERS.Error,
  quickReply: { items: [ACTIONS.SS, ACTIONS.Plan] }
}]

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

// ==========[ Utility ]==========

// Date判定
function isValidDate(d) {
  return Object.prototype.toString.call(d) === "[object Date]" && !isNaN(d);
}

// 配列からランダムな要素を取得する
function _pickRandom_(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function createMessage() {
  Log.start();
  // 未来の予定すべて取得（時刻順）
  const records = extractUpcomingRecordsWithDateObjects();

  // 取得できないときはエラーメッセージ
  if (!records.length) return errorMessage;

  // 最初の予定を基準にする
  const first = records[0];
  const merged = [first];

  // 3日以内の予定があればマージ（同じ活動として）
  for (let i = 1; i < records.length; i++) {
    const next = records[i];
    const diffMs = next.date.getTime() - first.date.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffDays <= 3) {
      // 🧩 3日以内の予定 → 同じ活動としてマージ対象に追加
      merged.push(next);
    } else {
      // ⛔ それ以降は無視
      break;
    }
  }

  // 🎲 ランダム取得
  const randomTitle = _pickRandom_(RANDOM_TEXTS.title);
  const randomIntro = _pickRandom_(RANDOM_TEXTS.intro);
  const randomClosing = _pickRandom_(RANDOM_TEXTS.closing);

  // メッセージを作成
  const messageLines = [
    randomTitle,
    randomIntro,// 📌 最初のmemo1をタイトルに使用
  ];

  for (const record of merged) {
    messageLines.push(`${record.memo1}`);
    messageLines.push(`　${record.formatted.date} ${record.formatted.start}-${record.formatted.end}`);
    messageLines.push(`　${record.place}${record.memo2}`);
  }

  messageLines.push(randomClosing);

  // 最初のレコードのリンクがある場合だけ追加（複数リンク対応しない場合）
  if (first.link) {
    messageLines.push(first.link);
  }

  // 改行でメッセージ生成
  const messageText = messageLines.join('\n');

  // アクション（コピーや予定開くなど）
  const actions = [ACTIONS.FlexSender,ACTIONS.Copy(messageText), ACTIONS.SS, ACTIONS.Plan];

  console.log(messageText);

  Log.finish();

  return [{
    type: 'text', text: messageText,
    sender: SENDERS.Auto,
    quickReply: { items: actions }
  }];
}



function extractUpcomingRecordsWithDateObjects() {
  Log.start();
  const values = SHEETS.Plan.getDataRange().getValues();
  const dataRows = values.slice(1);
  const now = new Date();

  const result = [];

  for (const row of dataRows) {
    const [dateObj, startObj, endObj, place, memo1, memo2, link] = row;

    // 信頼できるDate判定
    const isValidDate = d => Object.prototype.toString.call(d) === "[object Date]" && !isNaN(d);

    if (!isValidDate(dateObj) || !isValidDate(startObj)) {
      Log.debug("⚠️ date or start invalid. skip.");
      continue;
    }

    const dateTime = new Date(dateObj);
    dateTime.setHours(startObj.getHours(), startObj.getMinutes(), 0, 0);

    // Log.debug("👉 比較: 予定 =", dateTime.toLocaleString(), " vs 現在 =", now.toLocaleString());

    if (dateTime >= now) {
      Log.debug("✅ 未来の予定ヒット！");
      result.push({
        date: dateTime,
        start: startObj,
        end: endObj,
        formatted: { // 整形データを持たせておく
          date: _formatDate_(dateTime, FORMAT.Date),
          start: _formatDate_(startObj, FORMAT.Time),
          end: _formatDate_(endObj, FORMAT.Time),
        },
        place, memo1, memo2, link
      });
    } else {
      // Log.debug("❌ 過去の予定として除外");
    }
  }

  // 未来の予定を時刻順にソート
  result.sort((a, b) => a.date - b.date);

  Log.finish({ result });
  return result;
}

function shouldSendRemindMessage() {
  Log.start();
  const records = extractUpcomingRecordsWithDateObjects();
  if (records.length === 0) return false;

  // ⏰ N日後の日付（時刻は00:00:00にリセット）
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
      // LineApiDriver.reply(messages); // ←任意の送信処理
    }
  } else {
    Log.debug("⏭️ リマインド対象日ではないためスキップ");
  }
  Log.finish();
}

