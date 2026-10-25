const TEXT_MESSAGE_HANDLERS = [
  {
    // 管理者だけ（21_adminTestDesk.gs）。ふつうの人には何も返さない
    matches: isAdminTestTriggerText_,
    createMessages: function (text, event) {
      return createAdminTestMessages_(text, event);
    }
  },
  {
    matches: isScheduleConfirmTriggerText_,
    createMessages: function (text, event) {
      return createScheduleConfirmMessages_(text, event);
    }
  },
  {
    matches: isScheduleCancelTriggerText_,
    createMessages: function (text, event) {
      return createScheduleCancelMessages_(text, event);
    }
  },
  {
    matches: isScheduleRegistrationTriggerText_,
    createMessages: function (text, event) {
      return createScheduleRegistrationMessages_(text, event);
    }
  },
  {
    matches: isFutureScheduleTriggerText_,
    createMessages: function () {
      return createAutoReminderFlexMessages_();
    }
  },
  {
    matches: isAutoReminderTestTriggerText_,
    createMessages: function () {
      return createAutoReminderFlexMessages_();
    }
  },
  {
    matches: isReminderTriggerText_,
    createMessages: function () {
      return createShareFlexMessages_();
    }
  }
];

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
      text: '⚠️ 内部エラーが発生しました。\n少し待ってから、もう一度送ってください。',
      sender: SENDERS.Error
    }];
  }
}

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
