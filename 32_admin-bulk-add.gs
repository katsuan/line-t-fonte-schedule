// ==========[ 管理ページ：文章でまとめて追加 ]==========
//
// 文章 → 読み取り（previewAdminBulkText_。書きこまない）→ 画面で確認 → まとめて登録（addAdminPlanRows_。1件でも不正なら書かない）。
// 読み取りはチャットの #予定登録 と同じ（13_schedule-registration.gs）。31_admin-api.gs から呼ばれる

/** 文章でまとめて追加の上限と、終了時刻の既定 */
const ADMIN_BULK_CONFIG = {
  maxRecords: 50,
  defaultDurationHours: DEFAULT_PLAN_DURATION_HOURS
};

/**
 * 文章を予定の候補に分解して返す（書き込まない）。
 * @return {{records: Object[], errors: {lineNumber: number, raw: string}[], autoFilledCount: number, truncated: boolean}}
 */
function previewAdminBulkText_(text) {
  const source = String(text || "");
  if (!source.trim()) throw createAdminError_("invalid", "予定の文章を入力してください。");

  // 既存のパーサは「1行目が #予定登録」の前提で、2行目から読む。チャットと同じ読み取りにするため、見出し行を足す
  const parsed = parseScheduleRegistrationLines_("#予定登録\n" + source);

  // リンクが無い予定は、同じ月の既存リンクで補う（チャットと同じ。優先順: 行のリンク > 末尾のURL > 既存の同月リンク）
  const autoFilledCount = applyExistingMonthlyLinkFallback_(parsed.records);

  const existingKeys = {};
  listPlanRecords_().forEach(function (row) { existingKeys[buildAdminBulkKey_(row)] = true; });

  const limited = parsed.records.slice(0, ADMIN_BULK_CONFIG.maxRecords);
  return {
    records: limited.map(function (record) { return toAdminBulkPreviewRecord_(record, existingKeys); }),
    // パーサの行番号は見出し行ぶん1行多いので、入力した文章の行番号にそろえる
    errors: parsed.errors.map(function (error) { return { lineNumber: error.lineNumber - 1, raw: String(error.raw).trim() }; }),
    autoFilledCount: autoFilledCount,
    truncated: parsed.records.length > limited.length
  };
}

/**
 * 確認済みの予定をまとめて書き込む。
 * 1件でも不正なら、どれも書き込まない（途中までの登録を残さない）。
 */
function addAdminPlanRows_(inputs) {
  if (!Array.isArray(inputs) || !inputs.length) {
    throw createAdminError_("invalid", "登録する予定がありません。");
  }
  if (inputs.length > ADMIN_BULK_CONFIG.maxRecords) {
    throw createAdminError_("invalid", `一度に登録できるのは${ADMIN_BULK_CONFIG.maxRecords}件までです。`);
  }

  const records = inputs.map(function (input, index) {
    try {
      return buildAdminRecordFromInput_(input);
    } catch (err) {
      throw createAdminError_(err.code || "invalid", `${index + 1}件目: ${err.message}`);
    }
  });

  const withoutLink = records.filter(function (record) { return !record.link; });
  if (withoutLink.length) applyExistingMonthlyLinkFallback_(withoutLink);

  appendScheduleRecordsToSheet_(records);
}

/** 読み取った予定を、確認画面に返す形にする（登録済みと同じなら duplicate） */
function toAdminBulkPreviewRecord_(record, existingKeys) {
  const start = _formatDate_(record.start, FORMAT.Time);
  const preview = {
    date: _formatDate_(record.date, "yyyy-MM-dd"),
    start: start,
    // 終了が書かれていなければ、開始の2時間後（管理ページの追加フォームと同じ初期値）
    end: record.end ? _formatDate_(record.end, FORMAT.Time) : defaultAdminEndTime_(record.start),
    endIsDefault: !record.end,
    place: record.place,
    memo1: record.memo1,
    memo2: record.memo2 || "",
    link: record.link || ""
  };
  preview.duplicate = !!existingKeys[buildAdminBulkKey_(preview)];
  return preview;
}

/** 登録済みと同じ予定かを見分けるキー（日付・開始・場所） */
function buildAdminBulkKey_(record) {
  return [record.date, record.start, record.place].join("|");
}

/** 開始の2時間後（日をまたがないよう、23:59までに収める） */
function defaultAdminEndTime_(startDate) {
  const limit = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 23, 59);
  const end = new Date(startDate.getTime() + ADMIN_BULK_CONFIG.defaultDurationHours * MS_PER_HOUR_);
  return _formatDate_(end > limit ? limit : end, FORMAT.Time);
}
