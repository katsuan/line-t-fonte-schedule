// ==========[ 天気（Open-Meteo）：近い予定の場所と日付の天気 ]==========
//
// いまは WEATHER_CONFIG.Enabled = false（00_setup.gs）で止めている（取得も表示もしない）。
// 位置は場所ごとに、予報はその日のうちだけ Script Properties に控える。カード（30_）から使う

/** 近い予定の「場所と日付 → 天気の短い文」。止めているときは空 */
function getNearTermWeatherSummaryMap_(records, now, nearTermDays, forceRefresh) {
  if (!WEATHER_CONFIG.Enabled) {
    return {};
  }

  const nearRecords = records.filter(record => record.place && isNearTermDate_(record.date, now, nearTermDays));

  if (!nearRecords.length) {
    return {};
  }

  const recordsByPlace = new Map();
  nearRecords.forEach(record => {
    const placeKey = normalizeWeatherPlace_(record.place);
    if (!placeKey) return;

    if (!recordsByPlace.has(placeKey)) {
      recordsByPlace.set(placeKey, {
        place: record.place,
        dateKeys: new Set()
      });
    }

    recordsByPlace.get(placeKey).dateKeys.add(buildWeatherDateKey_(record.date));
  });

  const weatherSummaryMap = {};

  recordsByPlace.forEach(({ place, dateKeys }, placeKey) => {
    const sortedDateKeys = Array.from(dateKeys).sort();
    if (!sortedDateKeys.length) return;

    const forecastByDate = fetchDailyWeatherForecast_(
      place,
      sortedDateKeys[0],
      sortedDateKeys[sortedDateKeys.length - 1],
      forceRefresh
    );

    sortedDateKeys.forEach(dateKey => {
      const forecast = forecastByDate[dateKey];
      if (!forecast) return;

      const summaryText = formatWeatherSummaryText_(forecast.weatherCode);
      if (!summaryText) return;

      weatherSummaryMap[`${placeKey}__${dateKey}`] = summaryText;
    });
  });

  return weatherSummaryMap;
}

/** 天気の短い文（天気・気温・降水確率） */
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

/** 場所の位置を Open-Meteo で探す（控えがあれば使う） */
function fetchWeatherCoordinates_(place) {
  const placeKey = normalizeWeatherPlace_(place);
  if (!placeKey || !WEATHER_CONFIG.Enabled) return null;

  const cached = loadCachedWeatherCoordinates_(placeKey);
  if (cached) {
    return cached;
  }

  const query = buildWeatherSearchQuery_(placeKey);
  const url = `${WEATHER_CONFIG.GeocodeApiBaseUrl}?name=${encodeURIComponent(query)}&count=${WEATHER_CONFIG.GeocodeCount}&language=${encodeURIComponent(WEATHER_CONFIG.GeocodeLanguage)}&countryCode=${encodeURIComponent(WEATHER_CONFIG.GeocodeCountryCode)}&format=json`;

  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      Log.debug(`⚠️ geocode fetch failed: ${response.getResponseCode()} ${placeKey}`);
      return null;
    }

    const payload = JSON.parse(response.getContentText());
    const result = payload && Array.isArray(payload.results) ? payload.results[0] : null;

    if (!result || typeof result.latitude !== "number" || typeof result.longitude !== "number") {
      Log.debug(`⚠️ geocode result not found: ${placeKey}`);
      return null;
    }

    const coordinates = {
      latitude: result.latitude,
      longitude: result.longitude,
      name: result.name || placeKey
    };

    saveCachedWeatherCoordinates_(placeKey, coordinates);
    return coordinates;
  } catch (err) {
    Log.debug(`⚠️ geocode error: ${placeKey} ${err.message}`);
    return null;
  }
}

/** その場所の日ごとの予報を Open-Meteo から読む（控えがあれば使う） */
function fetchDailyWeatherForecast_(place, startDateKey, endDateKey, forceRefresh) {
  const placeKey = normalizeWeatherPlace_(place);
  if (!placeKey || !WEATHER_CONFIG.Enabled) return {};

  const cached = loadCachedWeatherForecast_(placeKey, startDateKey, endDateKey, forceRefresh);
  if (cached) {
    return cached;
  }

  const coordinates = fetchWeatherCoordinates_(placeKey);
  if (!coordinates) {
    return {};
  }

  const url = `${WEATHER_CONFIG.ForecastApiBaseUrl}?latitude=${encodeURIComponent(coordinates.latitude)}&longitude=${encodeURIComponent(coordinates.longitude)}&models=${encodeURIComponent(WEATHER_CONFIG.ForecastModels)}&daily=weather_code&timezone=${encodeURIComponent(WEATHER_CONFIG.TimeZone)}&start_date=${encodeURIComponent(startDateKey)}&end_date=${encodeURIComponent(endDateKey)}`;

  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      Log.debug(`⚠️ weather fetch failed: ${response.getResponseCode()} ${placeKey}`);
      return {};
    }

    const payload = JSON.parse(response.getContentText());
    const daily = payload && payload.daily ? payload.daily : null;
    if (!daily || !Array.isArray(daily.time) || !Array.isArray(daily.weather_code)) {
      Log.debug(`⚠️ weather payload invalid: ${placeKey}`);
      return {};
    }

    const forecastByDate = {};
    daily.time.forEach((dateKey, index) => {
      forecastByDate[dateKey] = {
        weatherCode: Number(daily.weather_code[index])
      };
    });

    saveCachedWeatherForecast_(placeKey, startDateKey, endDateKey, forecastByDate);
    return forecastByDate;
  } catch (err) {
    Log.debug(`⚠️ weather error: ${placeKey} ${err.message}`);
    return {};
  }
}

/** 場所の位置を探すときの言葉（別名・地域の言葉を足す） */
function buildWeatherSearchQuery_(place) {
  const normalized = normalizeWeatherPlace_(place);
  if (!normalized) return "";

  if (WEATHER_CONFIG.QueryAliases[normalized]) {
    return WEATHER_CONFIG.QueryAliases[normalized];
  }

  if (normalized.includes(WEATHER_CONFIG.AreaHint)) {
    return normalized;
  }

  return `${normalized} ${WEATHER_CONFIG.AreaHint}`.trim();
}

// ---------- キーと控え ----------

/** 天気の控えに使う日付の文字 */
function buildWeatherDateKey_(date) {
  return Utilities.formatDate(date, scriptTimeZone_(), "yyyy-MM-dd");
}

/** 場所の名前の空白をそろえる */
function normalizeWeatherPlace_(place) {
  return String(place || "").trim().replace(/\s+/g, " ");
}

/** 予定の場所と日付から、天気のキーを作る */
function buildWeatherRecordKey_(record) {
  return buildWeatherKeyFromPlaceAndDate_(record.place, record.date);
}

/** 場所と日付から、天気のキーを作る */
function buildWeatherKeyFromPlaceAndDate_(place, date) {
  return `${normalizeWeatherPlace_(place)}__${buildWeatherDateKey_(date)}`;
}

/** 場所の位置の控えのキー */
function buildWeatherGeocodePropertyKey_(placeKey) {
  return `${WEATHER_CONFIG.GeocodeCachePrefix}${createCacheHash_(placeKey)}`;
}

/** 予報の控えのキー（その日だけ使う） */
function buildWeatherForecastPropertyKey_(placeKey, startDateKey, endDateKey, todayKey) {
  return `${WEATHER_CONFIG.ForecastCachePrefix}${todayKey}_${createCacheHash_(`${placeKey}__${startDateKey}__${endDateKey}`)}`;
}

/** 控えのキーに使う短い印（MD5） */
function createCacheHash_(text) {
  return Utilities
    .computeDigest(Utilities.DigestAlgorithm.MD5, String(text || ""))
    .map(byte => (byte & 0xff).toString(16).padStart(2, "0"))
    .join("");
}

/** 場所の位置の控えを読む（なければ null） */
function loadCachedWeatherCoordinates_(placeKey) {
  const payload = PropertiesService.getScriptProperties().getProperty(buildWeatherGeocodePropertyKey_(placeKey));
  if (!payload) return null;

  try {
    const parsed = JSON.parse(payload);
    if (typeof parsed.latitude !== "number" || typeof parsed.longitude !== "number") {
      return null;
    }

    return parsed;
  } catch (err) {
    Log.debug(`⚠️ weather geocode cache parse failed: ${placeKey}`);
    return null;
  }
}

/** 場所の位置を控えに入れる */
function saveCachedWeatherCoordinates_(placeKey, coordinates) {
  PropertiesService.getScriptProperties().setProperty(
    buildWeatherGeocodePropertyKey_(placeKey),
    JSON.stringify({
      placeKey,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      name: coordinates.name || ""
    })
  );
}

/** 予報の控えの一覧を、今日のものだけにする（日が変わったら前の日の控えを消す） */
function ensureWeatherForecastCacheIndex_(props, todayKey) {
  const cachedDate = props.getProperty(WEATHER_CONFIG.ForecastCacheDateKey);
  const indexPayload = props.getProperty(WEATHER_CONFIG.ForecastCacheIndexKey);
  const index = indexPayload ? JSON.parse(indexPayload) : [];

  if (cachedDate === todayKey) {
    return Array.isArray(index) ? index : [];
  }

  if (Array.isArray(index)) {
    index.forEach(propertyKey => props.deleteProperty(propertyKey));
  }

  props.setProperty(WEATHER_CONFIG.ForecastCacheDateKey, todayKey);
  props.setProperty(WEATHER_CONFIG.ForecastCacheIndexKey, JSON.stringify([]));
  return [];
}

/** 予報の控えを読む（なければ null） */
function loadCachedWeatherForecast_(placeKey, startDateKey, endDateKey, forceRefresh) {
  if (forceRefresh) {
    return null;
  }

  const props = PropertiesService.getScriptProperties();
  const todayKey = getTodayCacheKey_();
  ensureWeatherForecastCacheIndex_(props, todayKey);
  const payload = props.getProperty(buildWeatherForecastPropertyKey_(placeKey, startDateKey, endDateKey, todayKey));

  if (!payload) return null;

  try {
    return JSON.parse(payload);
  } catch (err) {
    Log.debug(`⚠️ weather forecast cache parse failed: ${placeKey}`);
    return null;
  }
}

/** 予報を控えに入れる */
function saveCachedWeatherForecast_(placeKey, startDateKey, endDateKey, forecastByDate) {
  const props = PropertiesService.getScriptProperties();
  const todayKey = getTodayCacheKey_();
  const index = ensureWeatherForecastCacheIndex_(props, todayKey);
  const propertyKey = buildWeatherForecastPropertyKey_(placeKey, startDateKey, endDateKey, todayKey);

  props.setProperty(propertyKey, JSON.stringify(forecastByDate));

  if (!index.includes(propertyKey)) {
    index.push(propertyKey);
    props.setProperty(WEATHER_CONFIG.ForecastCacheIndexKey, JSON.stringify(index));
  }
}
