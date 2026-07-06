function handleTextMessage(event) {
  if (!event || !event.message || event.message.type !== 'text' || typeof event.message.text !== 'string') {
    return;
  }

  const text = event.message.text.trim();

  if (isFutureScheduleTriggerText_(text)) {
    return createAutoReminderFlexMessages_();
  }

  if (isAutoReminderTestTriggerText_(text)) {
    return createAutoReminderFlexMessages_();
  }

  if (isReminderTriggerText_(text)) {
    return createShareFlexMessages_();
  }

  return;
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
