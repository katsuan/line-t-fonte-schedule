// ==========[ Plan シートの読み書き ]==========
//
// 列の並び: date / start / end / place / memo1 / memo2 / link（1行目は見出し）
// - 読み取りは1回の呼び出しで1回だけにして使い回す（readPlanValues_）。書いたら forgetPlanValues_
// - 外から来た文字は safeCell_ を通して書く（式として動かないように）
// チャット（13_）・管理ページ（31_・32_）・公開カレンダー（33_）・カレンダー同期（34_）から使う

/** Plan シートの列の数（date / start / end / place / memo1 / memo2 / link） */
const PLAN_COLUMN_COUNT_ = 7;

/** Plan シートのリンクの列 */
const PLAN_LINK_COLUMN_ = 7;

// ---------- 読む ----------

/** Plan シートの全体（見出し行も含む）。同じ呼び出しの中では使い回す。中身は書きかえないこと */
function readPlanValues_() {
  return memo_("planValues", function () {
    return SHEETS.Plan.getDataRange().getValues();
  });
}

/** シートに書いたあとに呼ぶ。使い回している読み取り結果を捨てる */
function forgetPlanValues_() {
  forgetMemo_("planValues");
  forgetMemo_("planRecords");
}

/**
 * 日付が入っている行を、画面や API で使う文字列の形にしたもの（rowNumber はシートの行番号）。
 * 同じ呼び出しの中では使い回す。中身は書きかえないこと
 */
function listPlanRecords_() {
  return memo_("planRecords", function () {
    const records = [];
    readPlanValues_().forEach(function (row, index) {
      if (index === 0) return;
      const record = mapPlanRowToRecord_(row, index + 1);
      if (record) records.push(record);
    });
    return records;
  });
}

/**
 * 同じ予定かを見分けるキー（日付・開始・場所）。#予定登録 の「重複」と、管理ページの「文章で追加」の「登録済みと同じ」で使う
 * @param {string} date yyyy-MM-dd
 * @param {string} start HH:mm
 */
function buildPlanMatchKey_(date, start, place) {
  return [date, start, String(place || "").trim()].join("|");
}

/** 予定（listPlanRecords_ の形）を日付・開始の順に並べるときのくらべ方 */
function comparePlanRecords_(a, b) {
  return (a.date + a.start).localeCompare(b.date + b.start);
}

/** 場所に、言葉のどれかが入っているか（空き状況の施設・天気の位置） */
function placeHasWord_(place, words) {
  const text = String(place || "");
  return (words || []).some(function (word) { return word && text.indexOf(word) >= 0; });
}

/**
 * リンクの欄に「なし」と書いた予定は、リンクなし（同じ月のリンクで補わない。月の共通リンクを入れなおしても入れない。
 * 公開カレンダーにも月のリンクを出さない）。空の欄は、まだリンクを決めていない予定（同じ月のリンクで補う）
 */
const NO_LINK_MARK_ = "なし";

/** リンクの欄を読む。「なし」なら { link: "", noLink: true } */
function readPlanLinkCell_(value) {
  const text = String(value || "");
  return text.trim() === NO_LINK_MARK_ ? { link: "", noLink: true } : { link: text, noLink: false };
}

/** Plan シートの1行を、画面や API に返す文字の形にする（日付のない行は null。リンクなしの予定だけ noLink: true） */
function mapPlanRowToRecord_(row, rowNumber) {
  if (!isValidDate(row[0])) return null;

  const cell = readPlanLinkCell_(row[6]);
  const record = {
    rowNumber: rowNumber,
    date: formatDateKey_(row[0]),
    start: isValidDate(row[1]) ? _formatDate_(row[1], FORMAT.Time) : "",
    end: isValidDate(row[2]) ? _formatDate_(row[2], FORMAT.Time) : "",
    place: String(row[3] || ""),
    memo1: String(row[4] || ""),
    memo2: String(row[5] || ""),
    link: cell.link
  };
  if (cell.noLink) record.noLink = true;
  return record;
}

// ---------- 書く ----------

/** 予定（Date を持つ形）を、シートの1行の並びにする。文字は safeCell_ を通す（LINE や画面から来た文字のため） */
function toPlanRow_(record) {
  return [
    record.date,
    record.start,
    record.end || "",
    safeCell_(record.place),
    safeCell_(record.memo1),
    safeCell_(record.memo2 || ""),
    record.noLink ? NO_LINK_MARK_ : safeCell_(record.link || "")
  ];
}

/**
 * = + - @ で始まる文字は、シートを開いたときに式として動くので、先頭に ' を付けて文字のままにする。
 * ' はシートでは見えず、読み直すと元の文字に戻る
 */
function safeCell_(value) {
  return typeof value === "string" && /^[=+\-@]/.test(value) ? `'${value}` : value;
}

/** 予定を Plan シートの最後に足す（前の行の書式をそろえ、公開カレンダーの版を進める） */
function appendScheduleRecordsToSheet_(records) {
  const lastRow = SHEETS.Plan.getLastRow();
  const rows = records.map(toPlanRow_);

  const destRange = SHEETS.Plan.getRange(lastRow + 1, 1, rows.length, PLAN_COLUMN_COUNT_);
  copyExistingRowFormatToRange_(lastRow, destRange);
  destRange.setValues(rows);
  forgetPlanValues_();
  bumpPlanVersion_();
}

/**
 * 新規行は既定の表示形式（yyyy/MM/dd 等）で書き込まれ、既存行の M/d・H:mm 表記と揃わないため、
 * 直前の既存データ行の書式を新規範囲へコピーしてから setValues する
 */
function copyExistingRowFormatToRange_(lastRow, destRange) {
  if (lastRow < 2) return;

  const templateRange = SHEETS.Plan.getRange(lastRow, 1, 1, destRange.getNumColumns());
  templateRange.copyTo(destRange, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
}

// ---------- 同じ月のリンクで補う ----------

/**
 * リンク未指定の予定を、Plan シート上の同月（yyyy-MM）の既存リンクで補完する。
 * 優先順位: 行自体のリンク > メッセージ末尾のURL > 同月の既存シートのリンク
 * 同月内で最も下（＝最後に登録された）行のリンクを採用する。
 */
function applyExistingMonthlyLinkFallback_(records) {
  const linkByYearMonth = {};
  let autoFilledCount = 0;

  records.forEach(function (record) {
    if (record.link || record.noLink) return;

    const yearMonthKey = buildYearMonthKey_(record.date);
    if (!(yearMonthKey in linkByYearMonth)) {
      linkByYearMonth[yearMonthKey] = findExistingLinkForYearMonth_(yearMonthKey);
    }

    if (linkByYearMonth[yearMonthKey]) {
      record.link = linkByYearMonth[yearMonthKey];
      autoFilledCount += 1;
    }
  });

  return autoFilledCount;
}

/**
 * 月の共通（回答）リンク：その月の予定でいちばん多く使われているリンク（同じ数なら下の行＝あとに登録したもの）。
 * 公開カレンダー・管理ページ（js/month-calendar.js の baseLinkFor）と同じ決め方。なければ空文字
 */
function findMonthCommonLink_(yearMonthKey) {
  const counts = {};
  let best = "";
  readPlanValues_().slice(1).forEach(function (row) {
    if (!isValidDate(row[0]) || buildYearMonthKey_(row[0]) !== yearMonthKey) return;
    const link = readPlanLinkCell_(row[PLAN_LINK_COLUMN_ - 1]).link.trim();
    if (!link) return;
    counts[link] = (counts[link] || 0) + 1;
    if (!best || counts[link] >= counts[best]) best = link;
  });
  return best;
}

/** その月の予定で、いちばん下の行のリンク（なければ空文字） */
function findExistingLinkForYearMonth_(yearMonthKey) {
  const dataRows = readPlanValues_().slice(1);

  for (let i = dataRows.length - 1; i >= 0; i--) {
    const dateObj = dataRows[i][0];
    const link = readPlanLinkCell_(dataRows[i][PLAN_LINK_COLUMN_ - 1]).link.trim();
    if (!isValidDate(dateObj) || !link) continue;
    if (buildYearMonthKey_(dateObj) === yearMonthKey) {
      return link;
    }
  }

  return '';
}
