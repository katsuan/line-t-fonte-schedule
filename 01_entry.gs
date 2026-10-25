// ==========[ 入口：ウェブアプリ・親のボット・トリガーから呼ばれる関数 ]==========
//
// - doGet / doPost … ウェブアプリ（公開カレンダー・リッチに送る・管理ページ）から
// - handleTextMessage・createAutoReminderMessages など … 親の LINE ボットから（ライブラリとして）。名前を変えると親が動かなくなる
// - onPlanSheetChanged・syncPlansToCalendarJob … トリガーから。名前を変えるとトリガーが動かなくなる
// 中身は短くし、長い処理はそれぞれのファイル（10_ 〜 34_）の関数を呼ぶ

// ---------- ウェブアプリ ----------

/** ウェブアプリの GET。?action=plans は公開カレンダーの予定、それ以外は画面（リッチに送る）用のカード */
function doGet(e) {
  try {
    if (e && e.parameter && e.parameter.action === "plans") {
      return createPublicCalendarResponse_();
    }

    const forceRefresh = !!(e && e.parameter && e.parameter.refresh === "1");
    const payload = createLiffPayload_(forceRefresh);

    return ContentService
      .createTextOutput(JSON.stringify({
        ok: true,
        messages: payload.previewMessages,
        previewMessages: payload.previewMessages,
        shareMessages: payload.shareMessages
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    // エラーの中身は画面に出さず、実行ログにだけ残す
    console.error(err);
    return ContentService
      .createTextOutput(JSON.stringify({
        ok: false,
        message: "予定を読み込めませんでした。少し待ってから、やり直してください。"
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// qcheck-ok: G3 管理ページだけの入口。LIFF のアクセストークンを LINE に確かめ、ADMIN_USER_IDS の人だけ（LINE の Webhook は親プロジェクトが受ける）
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
    Log.debug(`⚠️ admin api failed: ${err.message}`); // qcheck-ok: G2 実行ログだけ
    // 自分で決めた言葉（createAdminError_）だけを返す。思わぬエラーの中身は、実行ログにだけ残す
    // qcheck-ok: G2 code のあるものは createAdminError_ で自分で決めた言葉
    if (err.code) return createAdminResponse_({ ok: false, code: err.code, message: err.message });
    console.error(err);
    return createAdminResponse_({ ok: false, code: "error", message: ADMIN_API_CONFIG.unexpectedErrorMessage });
  }
}

// ---------- 親の LINE ボットから ----------

/** 親のボットから呼ばれる。トークの文字に合う返事（メッセージの並び）を返す。合わなければ undefined */
function handleTextMessage(event) {
  logScheduleDebug_('handleTextMessage:enter', {
    sourceType: event && event.source && event.source.type,
    sourceId: hashForLog_(resolveScheduleSourceId_(event)),
    messageType: event && event.message && event.message.type,
    text: event && event.message && event.message.text
  });

  if (!event || !event.message || event.message.type !== 'text' || typeof event.message.text !== 'string') {
    return;
  }

  const text = event.message.text.trim();
  return routeTextMessage_(text, event);
}

/** 親のボットから呼ばれる。いま通知する予定があるか */
function shouldSendRemindMessage() {
  Log.start();
  const records = extractUpcomingRecordsWithDateObjects();
  if (records.length === 0) return false;

  const targetRecords = getReminderTargetRecords_(records, new Date());
  Log.debug(`targetRecordCount=${targetRecords.length}`);

  Log.finish();
  return targetRecords.length > 0;
}

/** 親のボットから呼ばれる。通知の送り主の名前「対象日: 11/1, 11/3」 */
function createAutoReminderSenderName() {
  const records = extractUpcomingRecordsWithDateObjects();
  const targetRecords = getReminderTargetRecords_(records, new Date());
  return buildAutoReminderSenderNameFromRecords_(targetRecords);
}

/** 親のボットから呼ばれる。管理者への通知のカード */
function createAutoReminderMessages() {
  return createAutoReminderFlexMessages_();
}

/** 親のボットから呼ばれる。通知したあとに、通知の文面に入れた予定を送信済みにする */
function completeAutoReminderSend() {
  const records = extractUpcomingRecordsWithDateObjects();
  markAutoReminderRecordsAsSent_(records);
}

/** 文のリマインド（テキスト＋クイックリプライ）。予定がなければ errorMessage */
function createMessage() {
  Log.start();
  const records = extractUpcomingRecordsWithDateObjects();

  if (!records.length) return errorMessage;

  const messageText = buildReminderTextMessageTextFromRecords_(records);
  const actions = [ACTIONS.FlexSender, ACTIONS.Copy(trimClipboardText_(messageText)), ACTIONS.SS, ACTIONS.Plan];

  console.log(messageText);

  Log.finish();

  return [{
    type: 'text',
    text: messageText,
    sender: SENDERS.Auto,
    quickReply: { items: actions }
  }];
}

/** 自動リマインドの判定と、送信済みの記録（送るところは親のボットが持つ） */
function main() {
  Log.start();
  const records = extractUpcomingRecordsWithDateObjects();
  const targetRecords = getReminderTargetRecords_(records, new Date());

  if (targetRecords.length > 0) {
    const messages = createAutoReminderMessages();
    if (messages) {
      Log.debug("Flexリマインド送信");
      // LineApiDriver.PostAllMessages(GROUP_ID, messages);
      // LineApiDriver.reply(messages);
      completeAutoReminderSend();
    }
  } else {
    Log.debug("⏭️ リマインド対象日ではないためスキップ");
  }
  Log.finish();
}

// ---------- トリガーから ----------

/**
 * スプレッドシートが変更されたとき（人の手編集・行の挿入削除など）に動く。スクリプトからの書き込みでは動かない。
 * 公開カレンダーのキャッシュを作り直すため版を進め、Google カレンダーにもその場で反映する（CALENDAR_ID 未設定なら何もしない）
 */
function onPlanSheetChanged() {
  bumpPlanVersion_();
  syncPlansToCalendarSafely_(false);
}

/** 定期トリガーから呼ばれる。シートに変更があったときだけ同期する */
function syncPlansToCalendarJob() {
  syncPlansToCalendarSafely_(false);
}
