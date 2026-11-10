// ==========[ 管理ページの API：予定の一覧・追加・編集・削除 ]==========
//
// admin.html から POST で呼ばれる（doPost は 01_entry.gs）。
// - 本人確認: LIFF のアクセストークンを LINE に確かめて userId を決める（画面から送られた userId は信じない）
// - 権限: Script Property `ADMIN_USER_IDS` にいる人だけ。`whoami` だけは、管理者に登録する前に自分の userId を知るため開けている
// - 書きこみはロックの中で、画面が見ていた行とシートが同じときだけ

/** 管理ページの API の設定（管理者の一覧の名前・LIFF のチャネル・LINE の確かめ先） */
const ADMIN_API_CONFIG = {
  adminUserIdsProperty: "ADMIN_USER_IDS",
  liffChannelId: "2009927582",
  verifyUrl: "https://api.line.me/oauth2/v2.1/verify",
  profileUrl: "https://api.line.me/v2/profile",
  lockWaitMs: 10000,
  unexpectedErrorMessage: "うまくいきませんでした。少し待ってから、やり直してください。"
};

// 入力の長さの上限。リンクは LINE のカードのボタンに使うので、LINE の上限（1000字）まで
const ADMIN_INPUT_LIMITS_ = { text: 200, link: 1000 };

// ---------- 呼び出しと返事 ----------

/** 管理ページからの呼び出しを読む（中身・ログイン情報がなければエラー） */
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

/** JSON の返事にする */
function createAdminResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 画面にそのまま見せてよいエラー（code つき）を作る */
function createAdminError_(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// ---------- 本人確認・権限 ----------

/** LIFF のアクセストークンを LINE に確かめ、その人のプロフィール（userId・displayName）を返す */
function verifyLineProfile_(accessToken) {
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

  const profile = JSON.parse(profileResponse.getContentText());
  return { userId: profile.userId, displayName: String(profile.displayName || "") };
}

/** Script Property にカンマ区切りで入れた userId の一覧（ADMIN_USER_IDS・OWNER_USER_IDS） */
function readUserIdList_(propertyName) {
  const raw = PropertiesService.getScriptProperties().getProperty(propertyName) || "";
  return raw.split(",").map(function (id) { return id.trim(); }).filter(Boolean);
}

/** 管理者（Script Property `ADMIN_USER_IDS`）か */
function isAdminUserId_(userId) {
  return Boolean(userId) && readUserIdList_(ADMIN_API_CONFIG.adminUserIdsProperty).indexOf(userId) !== -1;
}

// ---------- 操作 ----------

/** 管理ページの操作（一覧・読み取り・同期・空き状況・追加・編集・削除・月のリンク）をして、最新の一覧を返す */
function runAdminAction_(request) {
  if (request.action === "list") return { ok: true, records: listPlanRecords_() };
  if (request.action === "parseSchedule") return Object.assign({ ok: true }, previewAdminBulkText_(request.text));
  if (request.action === "availability") return { ok: true, availability: readAdminAvailability_(request.fresh === true) };
  if (request.action === "syncCalendar") {
    return { ok: true, records: listPlanRecords_(), calendar: syncPlansToCalendarSafely_(true) };
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(ADMIN_API_CONFIG.lockWaitMs)) {
    throw createAdminError_("busy", "ほかの操作中です。少し待ってからやり直してください。");
  }

  try {
    if (request.action === "add") addAdminPlanRow_(request.record);
    else if (request.action === "addBatch") addAdminPlanRows_(request.records);
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

  // 書き込みのロックを手放してから同期する（同期も同じロックを使うため）。同期に失敗しても、保存は成功のまま返す
  return { ok: true, records: listPlanRecords_(), calendar: syncPlansToCalendarSafely_(true) };
}

/**
 * 「⚽ 空き」タブ：灘崎の今日から90日ぶんのマス（空きのない日も）・見張る日・活動の日（読むだけ。開くたびにサイトを読む）。
 * サイトの返事は1時間しまって使う（fresh なら読み直す。「読みなおす」のボタン）。予定（⚽・ほかの場所）は毎回シートから。
 * ほかの場所の予定も elsewhere に添える（その日はこの施設に来られないかもしれないので、表の日の下に場所と時間を出す）
 */
function readAdminAvailability_(fresh) {
  const payload = buildAvailabilityApiPayload("#灘崎", new Date(), { spanDays: AVAILABILITY_DIGEST_DAYS, cacheMinutes: 60, fresh: Boolean(fresh) });
  if (payload.status !== "ok") return payload;
  const facility = AVAILABILITY_FACILITIES.filter(function (f) { return f.key === payload.facility.key; })[0] || {};
  const words = facility.placeWords || [];
  const dates = payload.days.map(function (day) { return day.date; });
  payload.elsewhere = listPlanRecords_()
    .filter(function (r) {
      return dates.indexOf(r.date) >= 0 && !words.some(function (word) { return r.place.indexOf(word) >= 0; });
    })
    .map(function (r) { return { date: r.date, start: r.start, end: r.end, place: r.place, memo1: r.memo1 }; })
    .sort(function (a, b) { return (a.date + a.start).localeCompare(b.date + b.start); });
  return payload;
}

/** 予定を1件足す（リンクがなければ同じ月のリンクで補う） */
function addAdminPlanRow_(input) {
  const record = buildAdminRecordFromInput_(input);
  if (!record.link) applyExistingMonthlyLinkFallback_([record]);
  appendScheduleRecordsToSheet_([record]);
}

/** 予定を1件書きかえる（画面が見ていた行と同じときだけ） */
function updateAdminPlanRow_(rowNumber, expected, input) {
  const row = assertAdminRowUnchanged_(rowNumber, expected);
  const record = buildAdminRecordFromInput_(input);
  SHEETS.Plan.getRange(row, 1, 1, PLAN_COLUMN_COUNT_).setValues([toPlanRow_(record)]); // qcheck-ok: G1 toPlanRow_ が safeCell_ を通す
  forgetPlanValues_();
}

/** 予定を1件消す（画面が見ていた行と同じときだけ） */
function deleteAdminPlanRow_(rowNumber, expected) {
  const row = assertAdminRowUnchanged_(rowNumber, expected);
  SHEETS.Plan.deleteRow(row);
  forgetPlanValues_();
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
  assertAdminLink_(nextLink, true);

  const previousLink = String(fromLink || "").trim();
  readPlanValues_().forEach(function (row, index) {
    if (index === 0 || !isValidDate(row[0])) return;
    if (_formatDate_(row[0], "yyyy-MM") !== month) return;

    const currentLink = String(row[6] || "").trim();
    if (currentLink && currentLink !== previousLink) return;

    SHEETS.Plan.getRange(index + 1, PLAN_LINK_COLUMN_).setValue(nextLink); // qcheck-ok: G1 http(s):// で始まる文字だけ
  });
  forgetPlanValues_();
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

  // 使い回しの読み取りではなく、いまのシートの行を読む
  const current = mapPlanRowToRecord_(
    SHEETS.Plan.getRange(row, 1, 1, PLAN_COLUMN_COUNT_).getValues()[0],
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

/** 画面の入力を確かめて、シートに書く予定の形にする（まちがいは createAdminError_） */
function buildAdminRecordFromInput_(input) {
  const source = input || {};
  const day = parseAdminDateInput_(source.date);
  const startParts = parseScheduleTimeToken_(source.start);
  if (!startParts) throw createAdminError_("invalid", "開始時刻を入力してください。");

  const endText = String(source.end || "").trim();
  const endParts = endText ? parseScheduleTimeToken_(endText) : null;
  if (endText && !endParts) throw createAdminError_("invalid", "終了時刻が正しくありません。");

  const texts = readAdminTextInputs_(source);
  const link = String(source.link || "").trim();
  assertAdminLink_(link, false);

  return {
    date: day.date,
    start: new Date(day.year, day.month - 1, day.day, startParts.hour, startParts.minute),
    end: endParts ? new Date(day.year, day.month - 1, day.day, endParts.hour, endParts.minute) : null,
    place: texts.place,
    memo1: texts.memo1,
    memo2: texts.memo2,
    link: link
  };
}

/** 「2026-11-02」を確かめて、年・月・日とその日の Date にする（ない日付はまちがい） */
function parseAdminDateInput_(text) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ""));
  if (!dateMatch) throw createAdminError_("invalid", "日付を入力してください。");

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw createAdminError_("invalid", "日付が正しくありません。");
  }
  return { year: year, month: month, day: day, date: date };
}

/** 場所・内容・補足を読む（場所と内容は要る。長すぎればまちがい） */
function readAdminTextInputs_(source) {
  const place = String(source.place || "").trim();
  const memo1 = String(source.memo1 || "").trim();
  const memo2 = String(source.memo2 || "").trim();
  if (!place || !memo1) throw createAdminError_("invalid", "場所と内容を入力してください。");
  if ([place, memo1, memo2].some(function (text) { return text.length > ADMIN_INPUT_LIMITS_.text; })) {
    throw createAdminError_("invalid", `場所・内容・補足は${ADMIN_INPUT_LIMITS_.text}文字までにしてください。`);
  }
  return { place: place, memo1: memo1, memo2: memo2 };
}

/** リンクの形と長さを確かめる。required でなければ空はよい */
function assertAdminLink_(link, required) {
  if (!link && !required) return;
  if (!/^https?:\/\//.test(link)) throw createAdminError_("invalid", "リンクは http(s):// から入力してください。");
  if (link.length > ADMIN_INPUT_LIMITS_.link) {
    throw createAdminError_("invalid", `リンクは${ADMIN_INPUT_LIMITS_.link}文字までにしてください。`);
  }
}
