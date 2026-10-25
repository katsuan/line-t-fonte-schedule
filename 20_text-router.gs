// ==========[ トークの文字の振り分け ]==========
//
// handleTextMessage（01_entry.gs）から呼ばれ、トリガーの言葉（#予定登録・#今後の予定・#リマインド・#テスト など）に合う返事を選ぶ。
// GAS はファイルを名前の順に読むので、あとのファイルの関数は、呼ばれたときに探す（読みこみ時に直接使わない）

/**
 * トリガーの言葉と返事の対応（上から順に見て、最初に合ったものを使う）。
 * 関数は呼ばれたときに名前で探すよう、どれも function で包む（あとのファイルの関数も使えるように）
 */
const TEXT_MESSAGE_HANDLERS = [
  // 管理者だけ（21_admin-test-desk.gs）。ふつうの人には何も返さない
  { matches: function (text) { return isAdminTestTriggerText_(text); }, createMessages: function (text, event) { return createAdminTestMessages_(text, event); } },
  { matches: function (text) { return isScheduleConfirmTriggerText_(text); }, createMessages: function (text, event) { return createScheduleConfirmMessages_(text, event); } },
  { matches: function (text) { return isScheduleCancelTriggerText_(text); }, createMessages: function (text, event) { return createScheduleCancelMessages_(text, event); } },
  { matches: function (text) { return isScheduleRegistrationTriggerText_(text); }, createMessages: function (text, event) { return createScheduleRegistrationMessages_(text, event); } },
  { matches: function (text) { return isFutureScheduleTriggerText_(text); }, createMessages: function () { return createAutoReminderFlexMessages_(); } },
  { matches: function (text) { return isAutoReminderTestTriggerText_(text); }, createMessages: function () { return createAutoReminderFlexMessages_(); } },
  // 「#リマインドテスト」より後に見る（どちらも #リマインド で始まるため）
  { matches: function (text) { return isReminderTriggerText_(text); }, createMessages: function () { return createShareFlexMessages_(); } }
];

/** トリガーの言葉に合う返事を作る。合わなければ undefined。エラーの中身は LINE に出さない */
function routeTextMessage_(text, event) {
  const matchedHandler = TEXT_MESSAGE_HANDLERS.find(function (handler) {
    return handler.matches(text);
  });

  if (!matchedHandler) {
    logScheduleDebug_('routeTextMessage:no-match', { text: text });
    return undefined;
  }

  try {
    const messages = matchedHandler.createMessages(text, event);
    logScheduleDebug_('routeTextMessage:success', {
      text: text,
      messageCount: Array.isArray(messages) ? messages.length : 0
    });
    return messages;
  } catch (err) {
    logScheduleDebug_('routeTextMessage:error', {
      text: text,
      message: err && err.message, // qcheck-ok: G2 DebugLog（管理者だけが見るシート）だけ
      stack: err && err.stack
    });

    // エラーの中身は LINE に出さず、DebugLog（上）にだけ残す
    return [{
      type: 'text',
      text: '⚠️ うまく返事を作れませんでした。\n少し待ってから、もう一度送ってください。',
      sender: SENDERS.Error
    }];
  }
}

// ---------- トリガーの言葉 ----------

/**
 * テキスト予定一覧トリガーか判定
 * (#今後の予定から始まる)
 */
function isFutureScheduleTriggerText_(text) {
  return text.startsWith('#今後の予定');
}

/**
 * 自動リマインドFlexテストトリガーか判定
 * (#リマインドテスト / #自動リマインドテスト から始まる)
 */
function isAutoReminderTestTriggerText_(text) {
  return text.startsWith('#リマインドテスト') || text.startsWith('#自動リマインドテスト');
}

/**
 * Flex予定一覧トリガーか判定
 * (#リマインドから始まる)
 */
function isReminderTriggerText_(text) {
  return text.startsWith('#リマインド');
}
