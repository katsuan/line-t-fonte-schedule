// ==========[ 天気（Open-Meteo）：近い予定の、その時間の天気 ]==========
//
// 場所の位置は WEATHER_CONFIG.Places（場所の言葉ごと）で決め、当たらなければ Default（岡山市）。
// 位置ごとに16日ぶんの1時間ごとの予報を1回で読み、CacheService に3時間しまう（Script Properties には書かない）。
// 予定の開始〜終了の時間から「☔雨 降水70% 12℃」の短い文を作る。カード（30_）から使う

/** 近い予定の「予定 → 天気の短い文」。止めているとき・読めないときは空 */
function getNearTermWeatherSummaryMap_(records, now, nearTermDays, forceRefresh) {
  if (!WEATHER_CONFIG.Enabled) return {};

  const nearRecords = records.filter(record => record.place && isNearTermDate_(record.date, now, nearTermDays));
  if (!nearRecords.length) return {};

  removeOldWeatherProperties_();
  const forecasts = {};
  const summaryMap = {};
  nearRecords.forEach(record => {
    const spot = resolveWeatherSpot_(record.place);
    if (!(spot.name in forecasts)) forecasts[spot.name] = fetchHourlyWeatherForecast_(spot, forceRefresh);
    const summary = summarizeWeatherForRecord_(forecasts[spot.name], record);
    if (summary) summaryMap[buildWeatherRecordKey_(record)] = summary;
  });
  return summaryMap;
}

/** 予定の場所から、天気を見る位置を決める（場所の言葉が入っていればその位置、なければ Default） */
function resolveWeatherSpot_(place) {
  const text = String(place || "");
  const hit = WEATHER_CONFIG.Places.filter(spot => spot.words.some(word => text.indexOf(word) >= 0))[0];
  return hit || WEATHER_CONFIG.Default;
}

/**
 * 予定の開始〜終了（終了がなければ開始から2時間）の天気の短い文。予報の外の日なら空。
 * 天気はいちばん悪いもの、降水確率はいちばん高いもの、気温は幅（2℃以上ちがえば「12〜15℃」）
 */
function summarizeWeatherForRecord_(forecast, record) {
  if (!forecast || !forecast.hours || !record.date) return "";
  const start = record.date.getTime();
  const endAt = record.endDate && record.endDate.getTime() > start ? record.endDate.getTime() : start + DEFAULT_PLAN_DURATION_HOURS * MS_PER_HOUR_;
  const from = Math.floor(start / MS_PER_HOUR_) * MS_PER_HOUR_;
  const hours = forecast.hours.filter(h => h.at >= from && h.at < endAt);
  if (!hours.length) return "";

  const worst = hours.reduce((a, b) => (weatherSeverity_(b.code) > weatherSeverity_(a.code) ? b : a));
  const label = formatWeatherSummaryText_(worst.code);
  if (!label) return "";
  const parts = [label];
  const rain = Math.max.apply(null, hours.map(h => (isFinite(h.rain) ? h.rain : -1)));
  if (rain >= 0) parts.push(`降水${rain}%`);
  const temps = hours.map(h => h.temp).filter(t => isFinite(t));
  if (temps.length) {
    const low = Math.round(Math.min.apply(null, temps));
    const high = Math.round(Math.max.apply(null, temps));
    parts.push(high - low >= 2 ? `${low}〜${high}℃` : `${Math.round(temps[0])}℃`);
  }
  return parts.join(" ");
}

/** 天気の悪さの順（雷 > 雪 > 雨 > 霧 > くもり > 晴れ間 > 晴れ） */
function weatherSeverity_(code) {
  if (code >= 95) return 6;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 5;
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 4;
  if (code === 45 || code === 48) return 3;
  if (code === 3) return 2;
  if (code === 1 || code === 2) return 1;
  return 0;
}

/** 天気の短い文（WMO の天気コードから） */
function formatWeatherSummaryText_(weatherCode) {
  if (!isFinite(weatherCode)) {
    return "";
  }

  if (weatherCode === 0) return "☀晴れ";
  if (weatherCode === 1 || weatherCode === 2) return "⛅晴れ";
  if (weatherCode === 3) return "☁くもり";
  if (weatherCode === 45 || weatherCode === 48) return "🌫霧";
  if ((weatherCode >= 51 && weatherCode <= 67) || (weatherCode >= 80 && weatherCode <= 82)) return "☔雨";
  if ((weatherCode >= 71 && weatherCode <= 77) || weatherCode === 85 || weatherCode === 86) return "❄雪";
  if (weatherCode >= 95 && weatherCode <= 99) return "⛈雷";
  return "🌤予報";
}

// ---------- 読む ----------

/**
 * その位置の16日ぶんの1時間ごとの予報（天気コード・降水確率・気温）。CacheService にしまってあれば使う。
 * 読めなければ null（天気を出さないだけで、カードはそのまま）
 * @return {{hours: Array<{at: number, code: number, rain: number, temp: number}>}|null}
 */
function fetchHourlyWeatherForecast_(spot, forceRefresh) {
  const cache = CacheService.getScriptCache();
  const key = `${WEATHER_CONFIG.CachePrefix}${spot.latitude}_${spot.longitude}`;
  if (!forceRefresh) {
    try {
      const cached = JSON.parse(cache.get(key) || "null");
      if (cached && Array.isArray(cached.hours)) return cached;
    } catch (err) { /* 読めなければ読み直す */ }
  }

  const url = `${WEATHER_CONFIG.ForecastApiBaseUrl}?latitude=${encodeURIComponent(spot.latitude)}&longitude=${encodeURIComponent(spot.longitude)}`
    + `&hourly=weather_code,precipitation_probability,temperature_2m&timezone=${encodeURIComponent(WEATHER_CONFIG.TimeZone)}`
    + `&forecast_days=${WEATHER_CONFIG.ForecastDays}&timeformat=unixtime`;
  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      Log.debug(`⚠️ weather fetch failed: ${response.getResponseCode()} ${spot.name}`);
      return null;
    }
    const hourly = (JSON.parse(response.getContentText()) || {}).hourly;
    if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly.weather_code)) {
      Log.debug(`⚠️ weather payload invalid: ${spot.name}`);
      return null;
    }
    const forecast = {
      hours: hourly.time.map((sec, i) => ({
        at: Number(sec) * 1000,
        code: Number(hourly.weather_code[i]),
        rain: hourly.precipitation_probability ? hourly.precipitation_probability[i] : null,
        temp: hourly.temperature_2m ? hourly.temperature_2m[i] : null
      }))
    };
    try {
      cache.put(key, JSON.stringify(forecast), WEATHER_CONFIG.CacheMinutes * 60);
    } catch (err) {
      Log.debug(`⚠️ weather cache put failed: ${err.message}`);
    }
    return forecast;
  } catch (err) {
    Log.debug(`⚠️ weather error: ${spot.name} ${err.message}`);
    return null;
  }
}

// ---------- キーと前の控え ----------

/** 予定の場所と開始の日時から、天気のキーを作る（カードの予定と天気の文を結ぶ） */
function buildWeatherRecordKey_(record) {
  const at = record.date ? Utilities.formatDate(record.date, scriptTimeZone_(), "yyyy-MM-dd HH:mm") : "";
  return `${String(record.place || "").trim().replace(/\s+/g, " ")}__${at}`;
}

/** 前に Script Properties にしまっていた天気の控えを消す（いまは CacheService にしまう） */
function removeOldWeatherProperties_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const keys = typeof props.getKeys === "function" ? props.getKeys() : Object.keys(props.getProperties());
    keys.filter(key => WEATHER_CONFIG.OldPropertyPrefixes.some(prefix => key.indexOf(prefix) === 0))
      .forEach(key => props.deleteProperty(key));
  } catch (err) {
    Log.debug(`⚠️ old weather properties cleanup failed: ${err.message}`);
  }
}
