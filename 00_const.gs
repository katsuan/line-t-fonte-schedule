// ==========[ 初期化：スプレッドシート ]==========
const prop = PropertiesService.getScriptProperties();
const SHEET_ID = prop.getProperty('SHEET_ID');
const GROUP_ID = prop.getProperty('GROUP_ID');
const ss = SpreadsheetApp.openById(SHEET_ID);

const SHEETS = {
  Plan: ss.getSheetByName("Plan"),
  Setting: ss.getSheetByName("Setting"),
}

// ==========[ 初期化：設定情報読込 ]==========
const SETTING = {
  RemindNum: Number(SHEETS.Setting.getRange("B2").getDisplayValue()),
  SheetLink: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=0`,
}

const LIFF_URLS = {
  FlexSender: "https://liff.line.me/2009927582-9QtOstUK"
}

const GROUP_LINK = "line://ti/g/hwc5nRC7mS"

const WEATHER_CONFIG = {
  Enabled: true,
  TimeZone: "Asia/Tokyo",
  ForecastApiBaseUrl: "https://api.open-meteo.com/v1/forecast",
  GeocodeApiBaseUrl: "https://geocoding-api.open-meteo.com/v1/search",
  ForecastModels: "jma_seamless",
  GeocodeCount: 1,
  GeocodeLanguage: "ja",
  GeocodeCountryCode: "JP",
  GeocodeCachePrefix: "WEATHER_GEOCODE_V1_",
  ForecastCacheDateKey: "WEATHER_FORECAST_CACHE_DATE_V1",
  ForecastCacheIndexKey: "WEATHER_FORECAST_CACHE_KEYS_V1",
  ForecastCachePrefix: "WEATHER_FORECAST_V1_",
  AreaHint: "岡山",
  QueryAliases: {
    "灘崎総合公園": "灘崎総合公園 岡山",
    "ニッショク岡山": "ニッショク岡山"
  }
}

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

const ICONS = {
  Auto: createIcon("自動\n返信", { textSize: 40 }),
  Copy: createIcon("↑", { bgColor: COLORS.White, textColor: COLORS.Black }),
  SS: createIcon("SS", { bgColor: COLORS.Green, textSize: 80 }),
  Soccer: createIcon("⚽", { bgColor: COLORS.Yellow, textColor: COLORS.Black, textSize: 100 }),
  Warning: createIcon("！", { bgColor: COLORS.Red, textSize: 120 }),
}

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

const now = new Date();

const NOW = {
  Date: _formatDate_(now, FORMAT.Date),
  Time: _formatDate_(now, FORMAT.Time),
}

// ==========[ クイックリプライアクション群 ]==========
const ACTIONS = {
  /** 
   * @param {string} text コピー対象の文字列
   */
  FlexSender: LINE_func.createQuickReply('リッチに送る', { type: 'uri', uri: LIFF_URLS.FlexSender }),
  Copy: (text = '') => (LINE_func.createQuickReply('Copy', { type: 'clipboard', text: text, imageUrl: ICONS.Copy })),
  SS: LINE_func.createQuickReply('シート', { type: 'uri', imageUrl: ICONS.SS, uri: SETTING.SheetLink }),
  Plan: LINE_func.createQuickReply('予定', { text: '#今後の予定', imageUrl: ICONS.Soccer })

}

// ==========[ 送信者設定 ]==========
const createSender = (name, iconUrl) => {
  return { name: name, iconUrl: iconUrl }
}

const SENDERS = {
  Error: createSender("エラー", ICONS.Warning),
  Auto: createSender("T-FONTE", ICONS.Auto),
}
