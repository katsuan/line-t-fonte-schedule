const TEXT_MESSAGE_HANDLERS = [
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
  if (!event || !event.message || event.message.type !== 'text' || typeof event.message.text !== 'string') {
    return;
  }

  const text = event.message.text.trim();
  return routeTextMessage_(text);
}

function routeTextMessage_(text) {
  const matchedHandler = TEXT_MESSAGE_HANDLERS.find(function (handler) {
    return handler.matches(text);
  });

  return matchedHandler ? matchedHandler.createMessages() : undefined;
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
