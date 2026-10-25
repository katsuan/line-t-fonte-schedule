// ==========[ #予定登録：トークの文章から予定をまとめて登録する ]==========
//
// #予定登録（読み取って確認カード）→ 確認カードの「登録する」（#予定確定 <下書きID>）→ シートに書く。
// - 入力は2つ：タブ区切り（Plan シートの列の順。シートからコピーした行）と、自由文（「8月2日 15:00〜17:00 灘崎総合公園 フットサル」）
// - 登録待ちは CacheService に10分。確認カードのボタンは、押されるたびに済んだ・古い・ほかの人・時間切れを見分けて返す
// 20_text-router.gs から呼ばれる。読み取りは管理ページの「文章で追加」（32_）も使う

/** 登録待ちの予定（CacheService）のキー・残す時間・ロックを待つ時間 */
const SCHEDULE_PENDING_CACHE_CONFIG = {
  keyPrefix: "SCHEDULE_PENDING_V1_",
  ttlSeconds: 600,
  confirmLockWaitMs: 10000,
  // 登録・取り消しが済んだ確認カードを覚えておく時間（CacheService の上限の6時間）。そのあとに押されたら「時間がたった」と返す
  doneKeyPrefix: "SCHEDULE_DONE_V1_",
  doneTtlSeconds: 6 * 60 * 60
};

// ---------- トリガーの言葉 ----------

/**
 * "#予定登録" トリガーか判定
 */
function isScheduleRegistrationTriggerText_(text) {
  return text.startsWith('#予定登録');
}

/**
 * "#予定確定" トリガーか判定（登録待ちの内容を確定してシートへ書き込む）
 */
function isScheduleConfirmTriggerText_(text) {
  return text.startsWith('#予定確定');
}

/**
 * "#予定キャンセル" トリガーか判定
 */
function isScheduleCancelTriggerText_(text) {
  return text.startsWith('#予定キャンセル');
}

/**
 * 確認カードのボタンは「#予定確定 <下書きID>」を送る。ID があれば、どの確認カードの操作かを見分けられる。
 * ID なし（手で「#予定確定」と打ったとき）は、そのトークでいま登録待ちのものを使う（これまでどおり）
 */
function readScheduleDraftId_(text) {
  const match = /^#予定(?:確定|キャンセル)[ \t　]+([0-9a-z]{8})\s*$/i.exec(String(text || '').trim());
  return match ? match[1].toLowerCase() : '';
}

// ---------- 返事 ----------

// 確認カードに並べる予定の数（多いと LINE のカードの大きさの上限をこえるため）。登録はすべてする
const SCHEDULE_CONFIRM_CARD_MAX_ROWS_ = 15;

/** #予定登録 の書き方の見本 */
const SCHEDULE_REGISTRATION_EXAMPLE_ =
  '書き方（1行に1件）:\n#予定登録\n11月2日 15:00〜17:00 灘崎総合公園 フットサル\n11/3 9:00〜 体育館 大会\n（最後の行にURLを書くと、参加リンクになります）';

/** #予定登録 の返事：読み取った予定を登録待ちにして、確認カードを返す（読めなければ書き方の見本） */
function createScheduleRegistrationMessages_(text, event) {
  const sourceId = resolveScheduleSourceId_(event);
  const parsedResult = parseScheduleRegistrationLines_(text);
  const records = parsedResult.records;
  const errors = parsedResult.errors;

  // まちがいの知らせは文のまま。直し方（書き方の見本）と、画面で入れる道を付ける
  if (!records.length) {
    return [{
      type: 'text',
      text: errors.length
        ? `⚠️ 読み取れる予定がありませんでした。\n${formatScheduleErrors_(errors)}\n\n${SCHEDULE_REGISTRATION_EXAMPLE_}`
        : `⚠️「#予定登録」の下に、予定を1行ずつ入力してください。\n\n${SCHEDULE_REGISTRATION_EXAMPLE_}`,
      sender: SENDERS.Error,
      quickReply: scheduleQuickReply_([ACTIONS.Admin])
    }];
  }

  const monthlyAutoFilledCount = applyExistingMonthlyLinkFallback_(records);

  const draftId = saveSchedulePendingRecords_(sourceId, records, resolveScheduleUserId_(event));

  // 読み取った予定は一覧のカードで見せる。登録・キャンセルのボタンは下書きIDを送るので、
  // 何日もあとに押されても、ボットがそのつど「済んだ・古い・ほかの人・時間切れ」を見分けて返す
  const actions = { confirmText: `#予定確定 ${draftId}`, cancelText: `#予定キャンセル ${draftId}` };
  const card = createScheduleConfirmFlexMessage_(records, {
    link: parsedResult.link,
    autoFilledCount: monthlyAutoFilledCount,
    errors: errors,
    actions: actions
  });
  card.sender = SENDERS.Auto;
  card.quickReply = scheduleQuickReply_(createScheduleDraftQuickReplyItems_(actions));
  return [card];
}

/**
 * 登録待ちをシートに書く。「登録する」を続けて押して2つ同時に動いても、
 * 同じ予定を2回書かないよう、ロックの中で「読む → 確かめる → 書く → 消す」をする。
 * カードのボタン（下書きID つき）は何日もあとにも押されるので、そのつど状態を見て返す
 */
function createScheduleConfirmMessages_(text, event) {
  const sourceId = resolveScheduleSourceId_(event);
  const draftId = readScheduleDraftId_(text);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SCHEDULE_PENDING_CACHE_CONFIG.confirmLockWaitMs)) {
    return [{
      type: 'text',
      text: '⚠️ ほかの登録の途中です。少し待ってから、もう一度「登録する」を押してください。',
      sender: SENDERS.Error,
      quickReply: scheduleQuickReply_([LINE_func.createQuickReply('登録する', { text: String(text || '#予定確定').trim() })])
    }];
  }

  let draft;
  let refusal;
  try {
    draft = loadSchedulePendingRecords_(sourceId);
    refusal = checkScheduleDraftAction_(draft, draftId, event);
    if (!refusal) {
      appendScheduleRecordsToSheet_(draft.records);
      clearSchedulePendingRecords_(sourceId);
      markScheduleDraftDone_(draft.id, 'registered');
    }
  } finally {
    lock.releaseLock();
  }

  if (refusal) return [refusal];

  extractUpcomingRecordsWithDateObjects(true);

  const confirmMessage = {
    type: 'text',
    text: `✅ ${draft.records.length}件登録しました。`,
    sender: SENDERS.Auto
  };

  return [confirmMessage].concat(createAutoReminderFlexMessages_());
}

/** #予定キャンセル の返事：登録待ちを消す（済んだ・古い・ほかの人のカードなら、その理由を返す） */
function createScheduleCancelMessages_(text, event) {
  const sourceId = resolveScheduleSourceId_(event);
  const draftId = readScheduleDraftId_(text);
  const draft = loadSchedulePendingRecords_(sourceId);
  const refusal = checkScheduleDraftAction_(draft, draftId, event);
  // 登録待ちがないときに手で「#予定キャンセル」と打ったのは、これまでどおり「キャンセルしました」
  if (refusal && (draftId || draft)) return [refusal];

  if (draft) {
    clearSchedulePendingRecords_(sourceId);
    markScheduleDraftDone_(draft.id, 'cancelled');
  }

  return [{
    type: 'text',
    text: 'キャンセルしました。',
    sender: SENDERS.Auto,
    quickReply: scheduleQuickReply_([ACTIONS.Plan, ACTIONS.Admin])
  }];
}

/**
 * 登録・キャンセルを進めてよいか。だめなら、その理由のやさしい返事を返す（よければ null）
 * - 済んだ確認カード（登録した・取り消した）／古い確認カード（新しい確認が出ている）／ほかの人の確認／時間切れ
 */
const SCHEDULE_DRAFT_REPLY_TEXTS_ = {
  registered: 'この確認カードの予定は、もう登録しています。\n登録した予定は「予定」から見られます。',
  cancelled: 'この確認カードは、キャンセル済みです。\n登録するときは、もう一度「#予定登録」から送ってください。',
  old: 'これは古い確認カードです。\nいちばん新しい確認カードの「登録する」を押してください。',
  // 同じトークで、あとからほかの人が #予定登録 を送ると、登録待ちはその人のものに入れかわる
  replaced: 'あとから別の人が「#予定登録」を送ったので、この確認は取り消されました。\n登録するときは、もう一度「#予定登録」から送ってください。',
  // 済んだ印（6時間）も消えたあとは、登録したかどうかがわからない。言い切らずに、確かめ方を書く
  expired: 'この確認カードは、受けつけの時間（10分）が過ぎています。\n登録できたかは「予定」で確かめられます。まだのときは、もう一度「#予定登録」から送ってください。',
  otherUser: 'この確認は、「#予定登録」を送った人だけが登録・キャンセルできます。',
  none: '登録待ちの予定はありません（登録が済んだか、時間がたって取り消されました）。\n新しく登録するときは「#予定登録」からどうぞ。'
};

/** 登録・キャンセルを進めてよいか。だめなら理由の返事、よければ null（済んだ・古い・時間切れ・ほかの人を見分ける） */
function checkScheduleDraftAction_(draft, draftId, event) {
  if (draftId && (!draft || draft.id !== draftId)) {
    const done = readScheduleDraftDone_(draftId);
    if (done === 'registered' || done === 'cancelled') return createScheduleDraftReply_(done);
    if (!draft) return createScheduleDraftReply_('expired');
    const presser = resolveScheduleUserId_(event);
    return createScheduleDraftReply_(draft.userId && presser && draft.userId !== presser ? 'replaced' : 'old');
  }

  if (!draft || !draft.records.length) return createScheduleDraftReply_('none');

  const userId = resolveScheduleUserId_(event);
  if (draft.userId && userId && draft.userId !== userId) return createScheduleDraftReply_('otherUser');

  return null;
}

/** 登録・キャンセルできないときの返事（kind は SCHEDULE_DRAFT_REPLY_TEXTS_ のキー） */
function createScheduleDraftReply_(kind) {
  return {
    type: 'text',
    text: SCHEDULE_DRAFT_REPLY_TEXTS_[kind],
    sender: SENDERS.Auto,
    quickReply: scheduleQuickReply_([ACTIONS.Plan, ACTIONS.Admin])
  };
}

// ---------- 確認カード ----------

/**
 * 「#予定登録」で読み取った予定の確認カード。
 * カードはトークに残り、クイックリプライは次のメッセージで消えるので、
 * あとで見ても通じるよう「#予定確定」と送れば登録できること・10分で消えることを書く
 */
function createScheduleConfirmFlexMessage_(records, notes) {
  const shown = records.slice(0, SCHEDULE_CONFIRM_CARD_MAX_ROWS_);
  const rows = shown.map(createScheduleConfirmRow_);
  if (records.length > shown.length) {
    rows.push(createScheduleNoteText_(`ほか${records.length - shown.length}件（登録はすべてします）`));
  }

  const noteTexts = [];
  if (notes.link) noteTexts.push(`🔗 参加リンク（リンクのない行に入れます）: ${notes.link}`);
  if (notes.autoFilledCount) noteTexts.push(`🔗 ${notes.autoFilledCount}件は、同じ月の予定のリンクを入れました。`);
  if (notes.errors && notes.errors.length) noteTexts.push(`⚠️ 読み取れなかった行（登録しません）:\n${formatScheduleErrors_(notes.errors)}`);

  const minutes = Math.round(SCHEDULE_PENDING_CACHE_CONFIG.ttlSeconds / 60);
  const bodyContents = rows.concat(noteTexts.map(createScheduleNoteText_));
  bodyContents.push({
    type: 'text',
    text: `下の「登録する」を押すと、シートに登録します（${minutes}分たつと取り消されます）。`,
    size: 'xs',
    color: FLEX_CONFIG.textSecondaryColor,
    wrap: true,
    margin: 'md'
  });

  return {
    type: 'flex',
    altText: trimAltText_(`📝 予定登録の確認：${records.length}件（${formatScheduleDateRange_(records)}）`),
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: FLEX_CONFIG.headerBackgroundColor,
        paddingAll: FLEX_CONFIG.headerPadding,
        contents: [
          { type: 'text', text: '予定登録の確認', size: 'xs', color: '#ffffff' },
          { type: 'text', text: `${records.length}件を登録しますか？`, size: 'lg', weight: 'bold', color: '#ffffff', wrap: true }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: FLEX_CONFIG.cardPadding,
        contents: bodyContents
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        contents: [
          { type: 'button', style: 'secondary', flex: 1, action: { type: 'message', label: 'キャンセル', text: notes.actions.cancelText } },
          { type: 'button', style: 'primary', flex: 2, action: { type: 'message', label: '登録する', text: notes.actions.confirmText } }
        ]
      }
    }
  };
}

/** 確認カードの予定1件：日時（曜日に色）と、内容・場所・補足 */
function createScheduleConfirmRow_(record) {
  const date = record.date;
  const time = `${_formatDate_(record.start, FORMAT.Time)}${record.end ? `-${_formatDate_(record.end, FORMAT.Time)}` : '〜'}`;
  const detail = [record.memo1, record.place, record.memo2, record.link ? '🔗' : ''].filter(Boolean).join(' ');

  return {
    type: 'box',
    layout: 'vertical',
    paddingAll: '8px',
    backgroundColor: FLEX_CONFIG.recordBackgroundColor,
    cornerRadius: '8px',
    contents: [
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: `${date.getMonth() + 1}/${date.getDate()}(`, size: 'sm', weight: 'bold', color: FLEX_CONFIG.textPrimaryColor, flex: 0 },
          { type: 'text', text: getJapaneseWeekday_(date), size: 'sm', weight: 'bold', color: getWeekdayTextColor_(date), flex: 0 },
          { type: 'text', text: `) ${time}`, size: 'sm', weight: 'bold', color: FLEX_CONFIG.textPrimaryColor, flex: 1 }
        ]
      },
      { type: 'text', text: detail || '予定', size: 'sm', color: FLEX_CONFIG.textSecondaryColor, wrap: true }
    ]
  };
}

/** 確認カードの小さな注意書き */
function createScheduleNoteText_(text) {
  return { type: 'text', text: text, size: 'xs', color: FLEX_CONFIG.textSecondaryColor, wrap: true, margin: 'sm' };
}

/** 「11/2〜11/5」（1日だけなら「11/2」） */
function formatScheduleDateRange_(records) {
  const times = records.map(function (record) { return record.date.getTime(); });
  const label = function (ms) { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const first = label(Math.min.apply(null, times));
  const last = label(Math.max.apply(null, times));
  return first === last ? first : `${first}〜${last}`;
}

/** 確認カードと同じ「登録する」「キャンセル」のクイックリプライ */
function createScheduleDraftQuickReplyItems_(actions) {
  return [
    LINE_func.createQuickReply('登録する', { text: actions.confirmText }),
    LINE_func.createQuickReply('キャンセル', { text: actions.cancelText })
  ];
}

/** クイックリプライの形にする */
function scheduleQuickReply_(items) {
  return { items: items };
}

/** 読み取れなかった行を「　2行目: 「…」」の形で並べる */
function formatScheduleErrors_(errors) {
  return errors.map(function (error) {
    return `　${error.lineNumber}行目: 「${error.raw.trim()}」`;
  }).join('\n');
}

// ---------- 文章の読み取り ----------

/** 自由文の1行（日付 時刻〜時刻 場所 内容） */
const SCHEDULE_FREEFORM_LINE_PATTERN_ = /^(\S+)[ \t　]+(\d{1,2}):(\d{2})[〜~\-][ \t　]*(?:(\d{1,2}):(\d{2}))?[ \t　]+(\S+)[ \t　]+(.+)$/;

/** URL の行 */
const SCHEDULE_LINK_LINE_PATTERN_ = /https?:\/\/\S+/;

/** 日付で始まる行（予定を書こうとした行。読めなければ「読み取れなかった行」に出す） */
const SCHEDULE_LINE_LOOKS_LIKE_ATTEMPT_PATTERN_ = /^\d{1,2}(月\d{1,2}日|\/\d{1,2})/;

/** シートからコピーした見出しの行 */
const SCHEDULE_HEADER_ROW_PATTERN_ = /^(date|日付)$/i;

/**
 * memo1 の絵文字補完ルール。「大会」は「フットサル」より優先する
 * （例: "フットサル大会" -> 🏆、"フットサル" -> ⚽）
 */
const SCHEDULE_MEMO_EMOJI_RULES_ = [
  { pattern: /大会/, emoji: '🏆' },
  { pattern: /イベント/, emoji: '🤝' },
  { pattern: /フットサル/, emoji: '⚽' }
];

/**
 * 自由文の末尾にある丸数字（任意で "(P)" "(T)" 等のコート表記付き）を memo2 として切り出す
 * コート表記は英字であれば種類を問わず読み飛ばす（P/T固定にしない）
 * 例: "フットサル（P）②" -> memo1="フットサル", memo2="②"
 */
const SCHEDULE_MEMO_TRAILING_TAG_PATTERN_ = /[（(]?\s*[A-Za-z]*\s*[）)]?\s*([①-⑩])\s*$/;

/**
 * タブを含む行は TSV（Plan シート列順）として厳密に読み、そうでない行は自由文として読む。
 * 予定行に混じらない末尾のURL行は、まだ link を持たない予定へ共通リンクとして適用する。
 * URLでも日付始まりでもない行（見出しなどの自由文）はエラーにせず無視する。
 */
function parseScheduleRegistrationLines_(text) {
  const lines = String(text || '').split(/\r?\n/).slice(1);
  const records = [];
  const errors = [];
  let link = '';

  lines.forEach(function (rawLine, index) {
    if (!rawLine.trim()) return;

    if (rawLine.indexOf('\t') !== -1) {
      const parsed = parseScheduleTsvLine_(rawLine);
      if (parsed === 'header') return;
      if (parsed) {
        records.push(parsed);
        return;
      }
      errors.push({ lineNumber: index + 2, raw: rawLine });
      return;
    }

    const line = rawLine.trim();
    const parsed = parseScheduleFreeformLine_(line);
    if (parsed) {
      records.push(parsed);
      return;
    }

    const urlMatch = line.match(SCHEDULE_LINK_LINE_PATTERN_);
    if (urlMatch) {
      link = urlMatch[0];
      return;
    }

    if (SCHEDULE_LINE_LOOKS_LIKE_ATTEMPT_PATTERN_.test(line)) {
      errors.push({ lineNumber: index + 2, raw: rawLine });
    }
  });

  if (link) {
    records.forEach(function (record) {
      if (!record.link) record.link = link;
    });
  }

  return { records: records, errors: errors, link: link };
}

/** タブ区切りの1行（Plan シートの列の順）を予定にする。見出しなら 'header'、読めなければ null */
function parseScheduleTsvLine_(rawLine) {
  const columns = rawLine.split('\t').map(function (col) { return col.trim(); });
  const dateToken = columns[0] || '';

  if (SCHEDULE_HEADER_ROW_PATTERN_.test(dateToken)) return 'header';

  const dateParts = parseScheduleDateToken_(dateToken);
  if (!dateParts) return null;

  const startParts = parseScheduleTimeToken_(columns[1]);
  if (!startParts) return null;

  return buildScheduleRecord_(dateParts, startParts, parseScheduleTimeToken_(columns[2]), {
    place: columns[3] || '',
    memo1: applyScheduleMemoEmoji_(columns[4] || ''),
    memo2: columns[5] || '',
    link: columns[6] || ''
  });
}

/** 自由文の1行を予定にする。読めなければ null */
function parseScheduleFreeformLine_(line) {
  const match = SCHEDULE_FREEFORM_LINE_PATTERN_.exec(line);
  if (!match) return null;

  const dateParts = parseScheduleDateToken_(match[1]);
  if (!dateParts) return null;

  const startParts = parseScheduleTimeToken_(`${match[2]}:${match[3]}`);
  if (!startParts) return null;

  const hasEnd = match[4] !== undefined && match[5] !== undefined;
  const endParts = hasEnd ? parseScheduleTimeToken_(`${match[4]}:${match[5]}`) : null;
  const memoParts = splitScheduleFreeformMemo_(match[7]);

  return buildScheduleRecord_(dateParts, startParts, endParts, {
    place: match[6],
    memo1: applyScheduleMemoEmoji_(memoParts.memo1),
    memo2: memoParts.memo2,
    link: ''
  });
}

/**
 * 日付と時刻から予定を作る。ない日付（2/30・13/1 など）は null（翌月にずらさない）
 */
function buildScheduleRecord_(dateParts, startParts, endParts, fields) {
  const month = dateParts.month;
  const day = dateParts.day;
  const year = resolveScheduleYear_(month, day);
  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;

  return Object.assign({
    date: date,
    start: new Date(year, month - 1, day, startParts.hour, startParts.minute),
    end: endParts ? new Date(year, month - 1, day, endParts.hour, endParts.minute) : null
  }, fields);
}

/**
 * "8月2日" と "8/2" の両方を許容する
 */
function parseScheduleDateToken_(token) {
  const t = String(token || '').trim();

  let match = /^(\d{1,2})月(\d{1,2})日$/.exec(t);
  if (match) return { month: Number(match[1]), day: Number(match[2]) };

  match = /^(\d{1,2})\/(\d{1,2})$/.exec(t);
  if (match) return { month: Number(match[1]), day: Number(match[2]) };

  return null;
}

/** 「15:00」を時と分にする。読めなければ null */
function parseScheduleTimeToken_(token) {
  const t = String(token || '').trim();
  if (!t) return null;

  const match = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;

  return { hour: hour, minute: minute };
}

/**
 * 7日以上前の日付になる場合は翌年とみなす（月をまたぐ一括登録時の年ズレ対策）
 */
function resolveScheduleYear_(month, day) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const candidate = new Date(currentYear, month - 1, day);
  const cutoff = startOfDay_(now);
  cutoff.setDate(cutoff.getDate() - 7);

  return candidate < cutoff ? currentYear + 1 : currentYear;
}

/** 自由文の内容を、内容（memo1）と末尾の丸数字（memo2）に分ける */
function splitScheduleFreeformMemo_(rawMemo) {
  const text = String(rawMemo || '').trim();
  const match = SCHEDULE_MEMO_TRAILING_TAG_PATTERN_.exec(text);
  if (!match) return { memo1: text, memo2: '' };

  return {
    memo1: text.slice(0, match.index).trim(),
    memo2: match[1]
  };
}

/** 内容に合う絵文字を先頭につける（すでにあればそのまま） */
function applyScheduleMemoEmoji_(memo1) {
  const text = String(memo1 || '');
  if (!text) return text;

  const matchedRule = SCHEDULE_MEMO_EMOJI_RULES_.find(function (rule) {
    return rule.pattern.test(text);
  });

  if (!matchedRule || text.indexOf(matchedRule.emoji) === 0) return text;

  return `${matchedRule.emoji}${text}`;
}

// ---------- 登録待ち（CacheService） ----------

/** 登録待ちを分ける単位（グループ・トークルーム・その人） */
function resolveScheduleSourceId_(event) {
  const source = (event && event.source) || {};
  return source.groupId || source.roomId || source.userId || "default";
}

/** 送った人の LINE の ID（わからなければ空文字） */
function resolveScheduleUserId_(event) {
  return (event && event.source && event.source.userId) || '';
}

/** 登録待ちのキー */
function buildSchedulePendingCacheKey_(sourceId) {
  return `${SCHEDULE_PENDING_CACHE_CONFIG.keyPrefix}${sourceId}`;
}

/**
 * 登録待ちを保存する。id（下書きID）と userId（#予定登録を送った人）も持つ。
 * @return {string} 下書きID
 */
function saveSchedulePendingRecords_(sourceId, records, userId) {
  const id = Utilities.getUuid().replace(/-/g, '').slice(0, 8).toLowerCase();
  const payload = JSON.stringify({
    id: id,
    userId: userId || '',
    records: records.map(function (record) {
      return {
        dateMs: record.date.getTime(),
        startMs: record.start.getTime(),
        endMs: record.end ? record.end.getTime() : null,
        place: record.place,
        memo1: record.memo1,
        memo2: record.memo2 || '',
        link: record.link || ''
      };
    })
  });

  CacheService.getScriptCache().put(
    buildSchedulePendingCacheKey_(sourceId),
    payload,
    SCHEDULE_PENDING_CACHE_CONFIG.ttlSeconds
  );
  return id;
}

/** @return {{id: string, userId: string, records: Object[]}|null} 前の形（予定の並びだけ）も読める */
function loadSchedulePendingRecords_(sourceId) {
  const payload = CacheService.getScriptCache().get(buildSchedulePendingCacheKey_(sourceId));
  if (!payload) return null;

  try {
    const parsed = JSON.parse(payload);
    const draft = Array.isArray(parsed) ? { id: '', userId: '', records: parsed } : parsed;
    if (!draft || !Array.isArray(draft.records)) return null;

    return {
      id: String(draft.id || ''),
      userId: String(draft.userId || ''),
      records: draft.records.map(function (item) {
        return {
          date: new Date(item.dateMs),
          start: new Date(item.startMs),
          end: item.endMs ? new Date(item.endMs) : null,
          place: item.place,
          memo1: item.memo1,
          memo2: item.memo2 || '',
          link: item.link || ''
        };
      })
    };
  } catch (err) {
    Log.debug(`⚠️ schedule pending cache parse failed: ${err.message}`);
    return null;
  }
}

/** 登録待ちを消す */
function clearSchedulePendingRecords_(sourceId) {
  CacheService.getScriptCache().remove(buildSchedulePendingCacheKey_(sourceId));
}

/** 済んだ確認カードを覚える（result: "registered" | "cancelled"） */
function markScheduleDraftDone_(draftId, result) {
  if (!draftId) return;
  CacheService.getScriptCache().put(
    `${SCHEDULE_PENDING_CACHE_CONFIG.doneKeyPrefix}${draftId}`,
    result,
    SCHEDULE_PENDING_CACHE_CONFIG.doneTtlSeconds
  );
}

/** 済んだ確認カードか（"registered" / "cancelled" / null） */
function readScheduleDraftDone_(draftId) {
  return draftId ? CacheService.getScriptCache().get(`${SCHEDULE_PENDING_CACHE_CONFIG.doneKeyPrefix}${draftId}`) : null;
}
