// ==========[ デバッグログ（スプレッドシート出力） ]==========
// 呼び出し元（親プロジェクト）の実行ログを確認できない状況向けに、
// このプロジェクトのスプレッドシートへ直接ログを残す。

const DEBUG_LOG_CONFIG = {
  sheetName: "DebugLog",
  maxRows: 500
};

function getDebugLogSheet_() {
  try {
    let sheet = ss.getSheetByName(DEBUG_LOG_CONFIG.sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(DEBUG_LOG_CONFIG.sheetName);
      sheet.appendRow(['timestamp', 'label', 'detail']);
    }
    return sheet;
  } catch (err) {
    return null;
  }
}

function logScheduleDebug_(label, detail) {
  try {
    const sheet = getDebugLogSheet_();
    if (!sheet) return;

    sheet.appendRow([new Date(), label, safeStringifyForLog_(detail)]);
    trimDebugLogSheet_(sheet);
  } catch (err) {
    // ログ出力自体の失敗で本処理を止めない
  }
}

function safeStringifyForLog_(value) {
  try {
    return JSON.stringify(value);
  } catch (err) {
    return String(value);
  }
}

function trimDebugLogSheet_(sheet) {
  const lastRow = sheet.getLastRow();
  const overflow = lastRow - DEBUG_LOG_CONFIG.maxRows;
  if (overflow > 1) {
    sheet.deleteRows(2, overflow);
  }
}
