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

/** Plan シートの1行を、画面や API に返す文字の形にする（日付のない行は null） */
function mapPlanRowToRecord_(row, rowNumber) {
  if (!isValidDate(row[0])) return null;

  return {
    rowNumber: rowNumber,
    date: _formatDate_(row[0], "yyyy-MM-dd"),
    start: isValidDate(row[1]) ? _formatDate_(row[1], FORMAT.Time) : "",
    end: isValidDate(row[2]) ? _formatDate_(row[2], FORMAT.Time) : "",
    place: String(row[3] || ""),
    memo1: String(row[4] || ""),
    memo2: String(row[5] || ""),
    link: String(row[6] || "")
  };
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
    safeCell_(record.link || "")
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
    if (record.link) return;

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

/** その月の予定で、いちばん下の行のリンク（なければ空文字） */
function findExistingLinkForYearMonth_(yearMonthKey) {
  const dataRows = readPlanValues_().slice(1);

  for (let i = dataRows.length - 1; i >= 0; i--) {
    const dateObj = dataRows[i][0];
    const link = dataRows[i][6];
    if (!isValidDate(dateObj) || !link) continue;
    if (buildYearMonthKey_(dateObj) === yearMonthKey) {
      return String(link).trim();
    }
  }

  return '';
}
