// ==========[ トークの文字の振り分け ]==========
//
// handleTextMessage（01_entry.gs）から呼ばれ、トリガーの言葉（#予定登録・#今後の予定・#リマインド・#テスト など）に合う返事を選ぶ。
// GAS はファイルを名前の順に読むので、あとのファイルの関数は、呼ばれたときに探す（読みこみ時に直接使わない）

/**
 * トリガーの言葉と返事の対応（上から順に見て、最初に合ったものを使う）。
 * 関数は呼ばれたときに名前で探すよう、どれも function で包む（あとのファイルの関数も使えるように）
 */
const TEXT_MESSAGE_HANDLERS = [
  // 管理者だけ（21_admin_test_desk.gs）。ふつうの人には何も返さない
  { matches: function (text) { return isAdminTestTriggerText_(text); }, createMessages: function (text, event) { return createAdminTestMessages_(text, event); } },
  { matches: function (text) { return isScheduleConfirmTriggerText_(text); }, createMessages: function (text, event) { return createScheduleConfirmMessages_(text, event); } },
  { matches: function (text) { return isScheduleCancelTriggerText_(text); }, createMessages: function (text, event) { return createScheduleCancelMessages_(text, event); } },
  { matches: function (text) { return isScheduleRegistrationTriggerText_(text); }, createMessages: function (text, event) { return createScheduleRegistrationMessages_(text, event); } },
  { matches: function (text) { return isFutureScheduleTriggerText_(text); }, createMessages: function () { return createAutoReminderFlexMessages_(); } },
  { matches: function (text) { return isAutoReminderTestTriggerText_(text); }, createMessages: function () { return createAutoReminderFlexMessages_(); } },
  // 施設の空き状況（15_availability.gs。ひしょっとと同じもの）。「#灘崎」「#灘崎 19-21」「#灘崎 土日」
  // 「#灘崎 見張り」（毎日のカードで見る日）はひしょっとだけの機能なので、ここでは受けない
  { matches: function (text) { return isAvailabilityText(text) && !/見張|みはり/.test(text); }, createMessages: function (text) { return createAvailabilityMessages_(text); } },
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

/** 施設の空き状況の返事に、T-FONTE の送り主を付ける */
function createAvailabilityMessages_(text) {
  return (handleAvailabilityText(text) || []).map(function (message) {
    return Object.assign({ sender: SENDERS.Auto }, message);
  });
}

/**
 * 空き状況のカードに ⚽ で出す、その施設での活動の予定（15_availability.gs が名前で探して呼ぶ）。
 * Plan シートの場所に、施設の placeWords（「灘崎」など）が入っている予定。終了が空なら DEFAULT_PLAN_DURATION_HOURS 時間。
 * 内容・補足の丸数字（①②）をコートの番号にする（なければどのコートかわからない予定）
 *
 * @param {{placeWords: string[]}} facility
 * @param {{start: string, end: string}} range 'yyyy-MM-dd'
 * @returns {Array<{date: string, start: number, end: number, courts: (number[]|undefined)}>} start・end は0時からの分
 */
function listAvailabilityActivities_(facility, range) {
  const words = (facility && facility.placeWords) || [];
  if (words.length === 0) return [];
  const minutes = function (time) { return time.getHours() * 60 + time.getMinutes(); };
  return readPlanValues_().slice(1).map(function (row) {
    const dateObj = row[0], startObj = row[1], endObj = row[2], place = String(row[3] || '');
    if (!isValidDate(dateObj) || !isValidDate(startObj)) return null;
    if (!words.some(function (word) { return place.indexOf(word) >= 0; })) return null;
    const date = Utilities.formatDate(dateObj, 'Asia/Tokyo', 'yyyy-MM-dd');
    if (date < range.start || date > range.end) return null;
    const start = minutes(startObj);
    const end = isValidDate(endObj) && minutes(endObj) > start ? minutes(endObj) : start + DEFAULT_PLAN_DURATION_HOURS * 60;
    // どのコートか：内容・補足の丸数字（登録では補足に「②」、手で書くなら「コート①②」）
    const courts = (String(row[4] || '') + ' ' + String(row[5] || '')).match(/[①-⑩]/g) || [];
    const numbers = courts.map(function (c) { return c.charCodeAt(0) - 0x2460 + 1; })
      .filter(function (n, i, all) { return all.indexOf(n) === i; });
    const activity = { date: date, start: start, end: Math.min(end, 24 * 60) };
    if (numbers.length) activity.courts = numbers;
    return activity;
  }).filter(Boolean);
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
