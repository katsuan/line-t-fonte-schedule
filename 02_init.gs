// ==========[ 読みこみ時の準備：シート・設定・アイコン・送り主・クイックリプライ ]==========
//
// どのファイルも使う共通の定数。ほかのファイルより先に読まれる（GAS はファイルを名前の順に読む）。
// 人が書きかえる設定は 00_setup.gs に置く

/** ログ（親プロジェクトと同じ LoggerLib） */
const Log = LoggerLib.createLogger(LoggerLib.createLogger().LEVEL.DEBUG);

// ==========[ 初期化：スプレッドシート ]==========
const prop = PropertiesService.getScriptProperties();

/** 予定のスプレッドシートの ID（Script Property `SHEET_ID`） */
const SHEET_ID = prop.getProperty('SHEET_ID');

/** 通知先の LINE グループの ID（Script Property `GROUP_ID`） */
const GROUP_ID = prop.getProperty('GROUP_ID');

/** 予定のスプレッドシート */
const ss = SpreadsheetApp.openById(SHEET_ID);

/** 使うシート（Plan: 予定、Setting: 設定） */
const SHEETS = {
  Plan: ss.getSheetByName("Plan"),
  Setting: ss.getSheetByName("Setting"),
}

// ---------- 設定（Setting シート） ----------

// ==========[ 初期化：設定情報読込 ]==========
const SETTING = {
  RemindNum: parseRemindNum_(SHEETS.Setting.getRange("B2").getDisplayValue()),
  SheetLink: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=0`,
}

/**
 * Setting!B2（何日前から通知するか）。空や数字でないときは NaN（通知しない）。
 * Number("") は 0 になり、空のまま「今日の予定」を通知してしまうので、空は別に扱う
 */
function parseRemindNum_(text) {
  const trimmed = String(text == null ? "" : text).trim();
  return trimmed === "" ? NaN : Number(trimmed);
}

// ---------- 色・アイコン ----------

// ==========[ 定数：色 ]==========
const COLORS = {
  Base: "3d4070",
  Green: "1FAC47",
  Yellow: "FABC03",
  White: "FFFFFF",
  Black: "000000",
  Red: "F72A25",
}

// ==========[ 関数：アイコン生成 ]==========
const PLACEHOLD = {
  BaseUrl: "https://placehold.jp/",
  Size: "150x150",
  BgColor: COLORS.Base, // 背景色
  TextColor: COLORS.White, // テキスト色
  TextSize: "100"
};

/**
 * アイコン画像のURLを作成
 * @param {string} bg 背景色（例: "F72A25"）
 * @param {string} text 表示する文字（絵文字も可。URLエンコードされる）
 * @param {Object} [options] オプション（bgColor: 背景色, textColor: テキスト色, size: サイズ, textSize: テキストサイズ）
 * 色は16進数カラーコード
 * @return {string} アイコンのURL
 */
const createIcon = (text = '', options = {}) => {
  const size = options.size || PLACEHOLD.Size;
  const bgColor = options.bgColor || PLACEHOLD.BgColor;
  const textColor = options.textColor || PLACEHOLD.TextColor;
  const textSize = options.textSize || PLACEHOLD.TextSize;
  const encodedText = encodeURIComponent(text);

  return `${PLACEHOLD.BaseUrl}${textSize}/${bgColor}/${textColor}/${size}.png?text=${encodedText}`;
};

/** 送り主やクイックリプライのアイコン */
const ICONS = {
  Auto: createIcon("自動\n返信", { textSize: 40 }),
  Copy: createIcon("↑", { bgColor: COLORS.White, textColor: COLORS.Black }),
  SS: createIcon("SS", { bgColor: COLORS.Green, textSize: 80 }),
  Soccer: createIcon("⚽", { bgColor: COLORS.Yellow, textColor: COLORS.Black, textSize: 100 }),
  Warning: createIcon("！", { bgColor: COLORS.Red, textSize: 120 }),
}

// ---------- 日付の書式 ----------

// ==========[ 初期化：日付・時間 ]==========
const FORMAT = {
  TimeZone: "JST",
  Date: "M月d日",
  Time: "HH:mm"
}

// 日付フォーマット
function _formatDate_(date, pattern) {
  return Utilities.formatDate(date, FORMAT.TimeZone, pattern);
}

// ---------- クイックリプライ・送り主 ----------

// ==========[ クイックリプライアクション群 ]==========
const ACTIONS = {
  /** 
   * @param {string} text コピー対象の文字列
   */
  FlexSender: LINE_func.createQuickReply('リッチに送る', { type: 'uri', uri: LIFF_URLS.FlexSender }),
  Admin: LINE_func.createQuickReply('予定を管理', { type: 'uri', uri: LIFF_URLS.Admin }),
  Copy: (text = '') => (LINE_func.createQuickReply('Copy', { type: 'clipboard', text: text, imageUrl: ICONS.Copy })),
  SS: LINE_func.createQuickReply('シート', { type: 'uri', imageUrl: ICONS.SS, uri: SETTING.SheetLink }),
  Plan: LINE_func.createQuickReply('予定', { text: '#今後の予定', imageUrl: ICONS.Soccer })

}

// ==========[ 送信者設定 ]==========
const createSender = (name, iconUrl) => {
  return { name: name, iconUrl: iconUrl }
}

/** 返事の送り主（名前とアイコン） */
const SENDERS = {
  Error: createSender("エラー", ICONS.Warning),
  Auto: createSender("T-FONTE", ICONS.Auto),
}
