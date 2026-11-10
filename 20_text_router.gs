// ==========[ トークの文字の振り分け ]==========
//
// handleTextMessage（01_entry.gs）から呼ばれ、トリガーの言葉（#予定登録・#今後の予定・#リマインド・#テスト など）に合う返事を選ぶ。
// GAS はファイルを名前の順に読むので、あとのファイルの関数は、呼ばれたときに探す（読みこみ時に直接使わない）

/**
 * トリガーの言葉と返事の対応（上から順に見て、最初に合ったものを使う）。
 * 関数は呼ばれたときに名前で探すよう、どれも function で包む（あとのファイルの関数も使えるように）
 */
const TEXT_MESSAGE_HANDLERS = [
  // 管理者にしてほしい人の申請（35_admin_request.gs）。承認できるのはサイト作成者だけ
  { matches: function (text) { return isAdminRequestText_(text); }, createMessages: function (text, event) { return createAdminRequestMessages_(text, event); }, noOwnerItems: true },
  // 管理者だけ（21_admin_test_desk.gs）。ふつうの人には何も返さない
  { matches: function (text) { return isAdminTestTriggerText_(text); }, createMessages: function (text, event) { return createAdminTestMessages_(text, event); }, noOwnerItems: true },
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
    let messages = matchedHandler.createMessages(text, event);
    if (!matchedHandler.noOwnerItems) messages = appendOwnerQuickReply_(messages, event);
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
      text: ROUTER_ERROR_TEXT,
      sender: SENDERS.Error,
      quickReply: { items: QUICK_REPLY_SETS.next() }
    }];
  }
}

/**
 * サイト作成者がボットとの1対1のトークで送ったときだけ、最後の返事のクイックリプライに 🔑 の項目（QUICK_REPLY_SETS.owner）を足す。
 * グループでは作成者が送っても足さない（ほかの人にも見えるため）。
 * もとの返事（使い回しの定数もある）は書きかえず、写しに足す
 */
function appendOwnerQuickReply_(messages, event) {
  if (!Array.isArray(messages) || !messages.length || !isSiteOwnerDirectChat_(event)) return messages;
  const copied = messages.slice();
  const last = Object.assign({}, copied[copied.length - 1]);
  const items = ((last.quickReply && last.quickReply.items) || []).concat(QUICK_REPLY_SETS.owner()).slice(0, 13);
  last.quickReply = { items: items };
  copied[copied.length - 1] = last;
  return copied;
}

/** 返事を作れなかったときの文（#テスト の見本も同じものを出す） */
const ROUTER_ERROR_TEXT = '⚠️ うまく返事を作れませんでした。\n少し待ってから、もう一度送ってください。';

/** 施設の空き状況の返事に、T-FONTE の送り主と、最後の1通にクイックリプライを付ける */
function createAvailabilityMessages_(text) {
  const messages = (handleAvailabilityText(text) || []).map(function (message) {
    return Object.assign({ sender: SENDERS.Auto }, message);
  });
  if (messages.length && !messages[messages.length - 1].quickReply) {
    messages[messages.length - 1].quickReply = { items: QUICK_REPLY_SETS.next() };
  }
  return messages;
}

/**
 * 空き状況のカードの下に足すリンク（15_availability.gs が読む）：管理ページの「⚽ 空き」タブ（今日から90日の表）。
 * 管理者でない人が開くと、管理者に頼むボタンが出る
 */
function availabilityExtraLinks_() {
  return [{ label: '90日の表を見る', uri: `${LIFF_URLS.Admin}?view=field` }];
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
    if (!placeHasWord_(place, words)) return null;
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

/** 「#今後の予定」か（予定のカードを返す） */
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
