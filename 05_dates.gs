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
