// ==========[ Google カレンダー同期：Plan シートの今日からの予定をカレンダーへ（シート→カレンダーの一方向） ]==========
//
// - 正はシート。このシステムが作った（タグのある）予定だけを足し・消す。手で作った予定・過去の予定には触れない
// - 中身（日時・場所・内容・補足・リンク）の印で同じ予定か見分け、変わった予定は消して作り直す
// - カレンダー ID は Script Property `CALENDAR_ID`。なければ何もしない
// - きっかけ：管理ページの保存直後・「カレンダー同期」ボタン（31_）／シートの手直し（onPlanSheetChanged）／1日1回（syncPlansToCalendarJob）
//   1日1回のものは、予定の版が前の同期から変わったときだけ動く

/** Google カレンダー同期の設定（ID の名前・タグ・同期する日数・ロック・定期実行の時刻） */
const CALENDAR_SYNC_CONFIG = {
  idProperty: "CALENDAR_ID",
  syncedVersionProperty: "CALENDAR_SYNCED_VERSION",
  statusProperty: "CALENDAR_SYNC_STATUS",
  tagKey: "tfonte_plan",
  defaultDurationHours: DEFAULT_PLAN_DURATION_HOURS,
  horizonDays: 400,
  lockWaitMs: 20000,
  triggerHour: 3
};

/** 同期の失敗で、予定の保存そのものを失敗させないための包み。失敗は結果として返す */
function syncPlansToCalendarSafely_(force) {
  try {
    return syncPlansToCalendar_(force);
  } catch (err) {
    Log.debug(`⚠️ calendar sync failed: ${err.message}`); // qcheck-ok: G2 実行ログだけ
    // qcheck-ok: G2 返す先は管理ページ（管理者だけ）。直し方の手がかりに中身を見せる
    return { ok: false, message: `カレンダー同期に失敗しました: ${err.message}` };
  }
}

/**
 * Plan シートの今日以降の予定を、カレンダーに合わせる。
 * @param {boolean} force true なら、シートの更新バージョンが前回と同じでも実行する
 * @return {{ok: boolean, skipped?: boolean, message?: string, created?: number, deleted?: number, kept?: number, failed?: number}}
 */
function syncPlansToCalendar_(force) {
  const props = PropertiesService.getScriptProperties();
  const calendarId = getCalendarSyncId_();
  if (!calendarId) {
    return { ok: false, skipped: true, message: "CALENDAR_ID が未設定です。" };
  }

  const version = getPlanVersion_();
  if (!force && version !== "0" && version === props.getProperty(CALENDAR_SYNC_CONFIG.syncedVersionProperty)) {
    return { ok: true, skipped: true, message: "シートに変更がないため、同期しませんでした。" };
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CALENDAR_SYNC_CONFIG.lockWaitMs)) {
    return { ok: false, message: "ほかの処理中のため、同期できませんでした。" };
  }

  try {
    const calendar = CalendarApp.getCalendarById(calendarId);
    if (!calendar) {
      return { ok: false, message: "カレンダーを開けません。CALENDAR_ID と、カレンダーの共有設定（変更権限）を確認してください。" };
    }

    const now = new Date();
    const rangeStart = startOfDay_(now);
    const rangeEnd = new Date(rangeStart.getTime() + CALENDAR_SYNC_CONFIG.horizonDays * MS_PER_DAY_);

    const desired = buildDesiredCalendarEvents_(_formatDate_(now, "yyyy-MM-dd"));
    const existing = groupSyncedEventsByHash_(listSyncedCalendarEvents_(calendar, rangeStart, rangeEnd));
    const result = reconcileCalendarEvents_(calendar, desired, existing);

    result.ok = result.failed === 0;
    if (result.ok) props.setProperty(CALENDAR_SYNC_CONFIG.syncedVersionProperty, version);
    result.message = `追加${result.created}件・削除${result.deleted}件・そのまま${result.kept}件${result.failed ? `・失敗${result.failed}件` : ""}`;
    props.setProperty(CALENDAR_SYNC_CONFIG.statusProperty, `${_formatDate_(new Date(), "yyyy-MM-dd HH:mm")} ${result.message}`);
    return result;
  } finally {
    lock.releaseLock();
  }
}

/** 同期先のカレンダーID（Script Property `CALENDAR_ID`）。未設定なら空文字。同じ呼び出しの中では1回だけ読む */
function getCalendarSyncId_() {
  return memo_("calendarSyncId", function () {
    return (PropertiesService.getScriptProperties().getProperty(CALENDAR_SYNC_CONFIG.idProperty) || "").trim();
  });
}

// ---------- シートとカレンダーを合わせる ----------

/**
 * シートの今日以降の予定を、カレンダーに作りたい予定の形にする。
 * 終了時刻が空、または開始以前のときは、開始の2時間後にする（管理ページの初期値と同じ）。
 */
function buildDesiredCalendarEvents_(todayDateKey) {
  return listPlanRecords_()
    .filter(function (row) { return row.date >= todayDateKey && row.start; })
    .map(function (row) {
      const start = parseCalendarDateTime_(row.date, row.start);
      let end = row.end ? parseCalendarDateTime_(row.date, row.end) : null;
      if (!end || end.getTime() <= start.getTime()) {
        end = new Date(start.getTime() + CALENDAR_SYNC_CONFIG.defaultDurationHours * MS_PER_HOUR_);
      }

      // タイトルは内容だけ。補足は説明欄に書き、改行してリンクを続ける（どちらも無ければ説明欄は空）
      const description = [row.memo2, row.link].filter(Boolean).join("\n");

      const event = {
        title: row.memo1,
        start: start,
        end: end,
        options: { location: row.place || "", description: description }
      };
      event.hash = hashCalendarEvent_(event);
      return event;
    });
}

/** 「2026-11-02」と「15:00」から日時を作る */
function parseCalendarDateTime_(dateText, timeText) {
  const date = dateText.split("-").map(Number);
  const time = timeText.split(":").map(Number);
  return new Date(date[0], date[1] - 1, date[2], time[0], time[1]);
}

/** カレンダーの予定の中身から作る印（同じ予定かを見分ける） */
function hashCalendarEvent_(event) {
  const source = JSON.stringify([
    event.title, event.start.getTime(), event.end.getTime(), event.options.location, event.options.description
  ]);
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, source, Utilities.Charset.UTF_8)
    .map(function (byte) { return ("0" + (byte & 0xff).toString(16)).slice(-2); })
    .join("");
}

/** このシステムが作った（タグのある）予定だけを取り出す */
function listSyncedCalendarEvents_(calendar, rangeStart, rangeEnd) {
  return calendar.getEvents(rangeStart, rangeEnd).filter(function (event) {
    return !!event.getTag(CALENDAR_SYNC_CONFIG.tagKey);
  });
}

/** カレンダーの予定を、印ごとにまとめる */
function groupSyncedEventsByHash_(events) {
  const grouped = {};
  events.forEach(function (event) {
    const hash = event.getTag(CALENDAR_SYNC_CONFIG.tagKey);
    (grouped[hash] = grouped[hash] || []).push(event);
  });
  return grouped;
}

/**
 * 同じ内容の予定はそのまま残し、足りない予定は作り、余った予定（シートに無い・内容が変わった・重複）は削除する。
 * 1件の失敗で全体を止めず、失敗件数を数える。
 */
function reconcileCalendarEvents_(calendar, desired, existingByHash) {
  const result = { created: 0, deleted: 0, kept: 0, failed: 0 };

  desired.forEach(function (event) {
    const sameEvents = existingByHash[event.hash];
    if (sameEvents && sameEvents.length) {
      sameEvents.pop();
      result.kept += 1;
      return;
    }

    try {
      calendar.createEvent(event.title, event.start, event.end, event.options)
        .setTag(CALENDAR_SYNC_CONFIG.tagKey, event.hash);
      result.created += 1;
    } catch (err) {
      Log.debug(`⚠️ calendar create failed: ${err.message}`);
      result.failed += 1;
    }
  });

  Object.keys(existingByHash).forEach(function (hash) {
    existingByHash[hash].forEach(function (event) {
      try {
        event.deleteEvent();
        result.deleted += 1;
      } catch (err) {
        Log.debug(`⚠️ calendar delete failed: ${err.message}`);
        result.failed += 1;
      }
    });
  });

  return result;
}

// ---------- トリガー ----------

/** 同じ関数を呼ぶトリガーを消してから、1つだけ作り直す（何度実行しても1つだけになる） */
function replaceProjectTrigger_(handlerFunction, configure) {
  ScriptApp.getProjectTriggers()
    .filter(function (trigger) { return trigger.getHandlerFunction() === handlerFunction; })
    .forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });

  configure(ScriptApp.newTrigger(handlerFunction)).create();
}
