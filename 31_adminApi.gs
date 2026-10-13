// ==========[ 管理者ページ用 API: 予定の一覧・追加・編集・削除 ]==========
//
// admin.html（別ページ）から POST で呼ばれる。
// - 本人確認: LIFF のアクセストークンを LINE API で検証し、userId を取得する
// - 権限: Script Property `ADMIN_USER_IDS`（カンマ区切りの userId）に含まれる人だけが読み書きできる
// - 本人確認だけで足りる `whoami` は、管理者登録前に自分の userId を確認するために開放している

const ADMIN_API_CONFIG = {
  adminUserIdsProperty: "ADMIN_USER_IDS",
  liffChannelId: "2009927582",
  verifyUrl: "https://api.line.me/oauth2/v2.1/verify",
  profileUrl: "https://api.line.me/v2/profile",
  lockWaitMs: 10000
};

const ADMIN_PLAN_COLUMNS_ = 7;

function doPost(e) {
  try {
    const request = parseAdminRequest_(e);
    const userId = verifyLineAccessToken_(request.accessToken);
    const isAdmin = isAdminUserId_(userId);

    if (request.action === "whoami") {
      return createAdminResponse_({ ok: true, userId: userId, isAdmin: isAdmin });
    }

    if (!isAdmin) {
      return createAdminResponse_({ ok: false, code: "forbidden", message: "管理者として登録されていません。" });
    }

    return createAdminResponse_(runAdminAction_(request));
  } catch (err) {
    Log.debug(`⚠️ admin api failed: ${err.message}`);
    return createAdminResponse_({ ok: false, code: err.code || "error", message: err.message });
  }
}

function createAdminResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function createAdminError_(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function parseAdminRequest_(e) {
  const raw = e && e.postData && e.postData.contents;
  if (!raw) throw createAdminError_("bad_request", "リクエストが空です。");

  let request;
  try {
    request = JSON.parse(raw);
  } catch (err) {
    throw createAdminError_("bad_request", "リクエストを読み取れませんでした。");
  }

  if (!request || !request.accessToken) {
    throw createAdminError_("unauthorized", "ログイン情報がありません。");
  }
  return request;
}

// ---------- 本人確認・権限 ----------

function verifyLineAccessToken_(accessToken) {
  const verifyResponse = UrlFetchApp.fetch(
    `${ADMIN_API_CONFIG.verifyUrl}?access_token=${encodeURIComponent(accessToken)}`,
    { muteHttpExceptions: true }
  );
  if (verifyResponse.getResponseCode() !== 200) {
    throw createAdminError_("unauthorized", "ログインの有効期限が切れました。開き直してください。");
  }

  const verified = JSON.parse(verifyResponse.getContentText());
  if (String(verified.client_id) !== ADMIN_API_CONFIG.liffChannelId || Number(verified.expires_in) <= 0) {
    throw createAdminError_("unauthorized", "このアプリ用のログインではありません。");
  }

  // profile スコープが無いトークンでは、プロフィール（userId）を取得できない
  if (String(verified.scope || "").split(/\s+/).indexOf("profile") === -1) {
    throw createAdminError_(
      "scope",
      `LIFFアプリのScopeで「profile」を有効にしてください（今のScope: ${verified.scope || "なし"}）。`
    );
  }

  const profileResponse = UrlFetchApp.fetch(ADMIN_API_CONFIG.profileUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    muteHttpExceptions: true
  });
  if (profileResponse.getResponseCode() !== 200) {
    throw createAdminError_(
      "unauthorized",
      `プロフィールを取得できませんでした（${profileResponse.getResponseCode()}）。`
    );
  }

  return JSON.parse(profileResponse.getContentText()).userId;
}

function isAdminUserId_(userId) {
  const raw = PropertiesService.getScriptProperties().getProperty(ADMIN_API_CONFIG.adminUserIdsProperty) || "";
  return raw.split(",").map(function (id) { return id.trim(); }).filter(Boolean).indexOf(userId) !== -1;
}

// ---------- アクション ----------

function runAdminAction_(request) {
  if (request.action === "list") return { ok: true, records: listAdminPlanRows_() };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(ADMIN_API_CONFIG.lockWaitMs)) {
    throw createAdminError_("busy", "ほかの操作中です。少し待ってからやり直してください。");
  }

  try {
    if (request.action === "add") addAdminPlanRow_(request.record);
    else if (request.action === "update") updateAdminPlanRow_(request.rowNumber, request.expected, request.record);
    else if (request.action === "delete") deleteAdminPlanRow_(request.rowNumber, request.expected);
    else if (request.action === "setMonthLink") setAdminMonthLink_(request.month, request.fromLink, request.link);
    else throw createAdminError_("bad_request", "不明な操作です。");

    SpreadsheetApp.flush();
    extractUpcomingRecordsWithDateObjects(true);
    bumpPlanVersion_();
  } finally {
    lock.releaseLock();
  }

  return { ok: true, records: listAdminPlanRows_() };
}

function listAdminPlanRows_() {
  const values = SHEETS.Plan.getDataRange().getValues();
  const records = [];

  values.forEach(function (row, index) {
    if (index === 0) return;
    const record = mapAdminRowToRecord_(row, index + 1);
    if (record) records.push(record);
  });

  return records;
}

function mapAdminRowToRecord_(row, rowNumber) {
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

function addAdminPlanRow_(input) {
  const record = buildAdminRecordFromInput_(input);
  if (!record.link) applyExistingMonthlyLinkFallback_([record]);
  appendScheduleRecordsToSheet_([record]);
}

function updateAdminPlanRow_(rowNumber, expected, input) {
  const row = assertAdminRowUnchanged_(rowNumber, expected);
  const record = buildAdminRecordFromInput_(input);
  const range = SHEETS.Plan.getRange(row, 1, 1, ADMIN_PLAN_COLUMNS_);

  range.setValues([[record.date, record.start, record.end || "", record.place, record.memo1, record.memo2, record.link]]);
}

function deleteAdminPlanRow_(rowNumber, expected) {
  const row = assertAdminRowUnchanged_(rowNumber, expected);
  SHEETS.Plan.deleteRow(row);
}

/**
 * 月の共通リンクを更新する。
 * 対象はその月の予定のうち、リンクが空か、これまでの共通リンク(fromLink)と同じ行だけ。
 * 予定ごとに別のリンクを入れている行は、そのまま残す。
 */
function setAdminMonthLink_(month, fromLink, link) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ""))) {
    throw createAdminError_("invalid", "月が正しくありません。");
  }

  const nextLink = String(link || "").trim();
  if (!/^https?:\/\//.test(nextLink)) {
    throw createAdminError_("invalid", "リンクは http(s):// から入力してください。");
  }

  const previousLink = String(fromLink || "").trim();
  const values = SHEETS.Plan.getDataRange().getValues();

  values.forEach(function (row, index) {
    if (index === 0 || !isValidDate(row[0])) return;
    if (_formatDate_(row[0], "yyyy-MM") !== month) return;

    const currentLink = String(row[6] || "").trim();
    if (currentLink && currentLink !== previousLink) return;

    SHEETS.Plan.getRange(index + 1, 7).setValue(nextLink);
  });
}

/**
 * 編集・削除の前に、画面が見ていた内容とシートの現在の内容が同じか確かめる。
 * 別の人の編集や #予定登録 で行がずれていたら、違う予定を壊さないよう止める。
 */
function assertAdminRowUnchanged_(rowNumber, expected) {
  const row = Number(rowNumber);
  if (!row || row < 2 || row > SHEETS.Plan.getLastRow() || !expected) {
    throw createAdminError_("stale", "シートが更新されています。再読み込みしてください。");
  }

  const current = mapAdminRowToRecord_(
    SHEETS.Plan.getRange(row, 1, 1, ADMIN_PLAN_COLUMNS_).getValues()[0],
    row
  );
  const fields = ["date", "start", "end", "place", "memo1", "memo2", "link"];
  const unchanged = current && fields.every(function (field) {
    return String(current[field]) === String(expected[field] || "");
  });

  if (!unchanged) {
    throw createAdminError_("stale", "シートが更新されています。再読み込みしてください。");
  }
  return row;
}

function buildAdminRecordFromInput_(input) {
  const source = input || {};
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(source.date || ""));
  if (!dateMatch) throw createAdminError_("invalid", "日付を入力してください。");

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw createAdminError_("invalid", "日付が正しくありません。");
  }

  const startParts = parseScheduleTimeToken_(source.start);
  if (!startParts) throw createAdminError_("invalid", "開始時刻を入力してください。");

  const endText = String(source.end || "").trim();
  const endParts = endText ? parseScheduleTimeToken_(endText) : null;
  if (endText && !endParts) throw createAdminError_("invalid", "終了時刻が正しくありません。");

  const place = String(source.place || "").trim();
  const memo1 = String(source.memo1 || "").trim();
  if (!place || !memo1) throw createAdminError_("invalid", "場所と内容を入力してください。");

  const link = String(source.link || "").trim();
  if (link && !/^https?:\/\//.test(link)) throw createAdminError_("invalid", "リンクは http(s):// から入力してください。");

  return {
    date: date,
    start: new Date(year, month - 1, day, startParts.hour, startParts.minute),
    end: endParts ? new Date(year, month - 1, day, endParts.hour, endParts.minute) : null,
    place: place,
    memo1: memo1,
    memo2: String(source.memo2 || "").trim(),
    link: link
  };
}
