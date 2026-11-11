// ==========[ 日付の小さな道具 ]==========
//
// 日の数え方（時刻を見ずに日付で数える）・月のキーなど。どのファイルからも使う

/** 1時間のミリ秒 */
const MS_PER_HOUR_ = 60 * 60 * 1000;

/** 1日のミリ秒 */
const MS_PER_DAY_ = 24 * MS_PER_HOUR_;

/** 正しい日付（Date で、日時が読める）か */
function isValidDate(d) {
  return Object.prototype.toString.call(d) === "[object Date]" && !isNaN(d);
}

/** その日の 0:00 */
function startOfDay_(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** baseDate の日から targetDate の日まで、何日あるか（時刻は見ない） */
function diffDaysFromToday_(targetDate, baseDate) {
  return Math.floor((startOfDay_(targetDate).getTime() - startOfDay_(baseDate).getTime()) / MS_PER_DAY_);
}

/** 今日から nearTermDays 日後までの予定か（「もうすぐ」の判定） */
function isNearTermDate_(date, now, nearTermDays) {
  const diffDays = diffDaysFromToday_(date, now);
  return diffDays >= 0 && diffDays <= nearTermDays;
}

/** スクリプトのタイムゾーン（読めなければ Asia/Tokyo） */
function scriptTimeZone_() {
  return Session.getScriptTimeZone ? Session.getScriptTimeZone() : "Asia/Tokyo";
}

/** 「11月」の文字 */
function buildMonthLabel_(date) {
  return `${date.getMonth() + 1}月`;
}

/** 「2026-11」の文字（月ごとに分けるときのキー） */
function buildYearMonthKey_(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** 「2026-11-02」の文字（シート・画面・API でそろえて使う日付のキー） */
function formatDateKey_(date) {
  return _formatDate_(date, "yyyy-MM-dd");
}

/** 「11/2」の文字 */
function formatMonthDay_(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** 「2026-11-02」と「15:00」から日時を作る（時刻がなければ、その日の 0:00） */
function parseDateTimeKey_(dateText, timeText) {
  const date = dateText.split("-").map(Number);
  const time = timeText ? timeText.split(":").map(Number) : [0, 0];
  return new Date(date[0], date[1] - 1, date[2], time[0], time[1]);
}

/** 予定のおわりの日時。終了が空か、開始より前・同じなら、開始の DEFAULT_PLAN_DURATION_HOURS 時間後 */
function resolvePlanEnd_(start, end) {
  if (end && end.getTime() > start.getTime()) return end;
  return new Date(start.getTime() + DEFAULT_PLAN_DURATION_HOURS * MS_PER_HOUR_);
}
