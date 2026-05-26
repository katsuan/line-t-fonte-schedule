function handleTextMessage(event) {
  const text = event.message.text.trim();

  if (isLogTargetText_(text)) {
    let messages = createMessage();
    return messages
  }

  return;
}

/**
 * 記録対象となるテキストか判定
 * (#今後の予定から始まる)
 */
function isLogTargetText_(text) {
  return text.startsWith('#今後の予定');
}