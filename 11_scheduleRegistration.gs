// ==========[ #予定登録: LINE会話からのスケジュール一括登録 ]==========
//
// 入力は2系統をサポートする。
// - TSV（タブ区切り）: Plan シートの列順（date/start/end/place/memo1/memo2/link）そのまま。
//   スプレッドシートからコピー&ペーストした行を想定。列を厳密に読む。
// - 自由文: "8月2日 15:00〜17:00 灘崎総合公園 フットサル" のように手入力する1件ずつの行。
//   place の次の1トークン以降を memo1 としてまとめて読む（memo2 は空）。

const SCHEDULE_PENDING_CACHE_CONFIG = {
  keyPrefix: "SCHEDULE_PENDING_V1_",
  ttlSeconds: 600,
  confirmLockWaitMs: 10000
};

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

// ---------- 入力パース ----------

const SCHEDULE_FREEFORM_LINE_PATTERN_ = /^(\S+)[ \t　]+(\d{1,2}):(\d{2})[〜~\-][ \t　]*(?:(\d{1,2}):(\d{2}))?[ \t　]+(\S+)[ \t　]+(.+)$/;
const SCHEDULE_LINK_LINE_PATTERN_ = /https?:\/\/\S+/;
const SCHEDULE_LINE_LOOKS_LIKE_ATTEMPT_PATTERN_ = /^\d{1,2}(月\d{1,2}日|\/\d{1,2})/;
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

function splitScheduleFreeformMemo_(rawMemo) {
  const text = String(rawMemo || '').trim();
  const match = SCHEDULE_MEMO_TRAILING_TAG_PATTERN_.exec(text);
  if (!match) return { memo1: text, memo2: '' };

  return {
    memo1: text.slice(0, match.index).trim(),
    memo2: match[1]
  };
}

function applyScheduleMemoEmoji_(memo1) {
  const text = String(memo1 || '');
  if (!text) return text;

  const matchedRule = SCHEDULE_MEMO_EMOJI_RULES_.find(function (rule) {
    return rule.pattern.test(text);
  });

  if (!matchedRule || text.indexOf(matchedRule.emoji) === 0) return text;

  return `${matchedRule.emoji}${text}`;
}

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

// ---------- 保留データのキャッシュ ----------

function resolveScheduleSourceId_(event) {
  const source = (event && event.source) || {};
  return source.groupId || source.roomId || source.userId || "default";
}

function buildSchedulePendingCacheKey_(sourceId) {
  return `${SCHEDULE_PENDING_CACHE_CONFIG.keyPrefix}${sourceId}`;
}

function saveSchedulePendingRecords_(sourceId, records) {
  const payload = JSON.stringify(records.map(function (record) {
    return {
      dateMs: record.date.getTime(),
      startMs: record.start.getTime(),
      endMs: record.end ? record.end.getTime() : null,
      place: record.place,
      memo1: record.memo1,
      memo2: record.memo2 || '',
      link: record.link || ''
    };
  }));

  CacheService.getScriptCache().put(
    buildSchedulePendingCacheKey_(sourceId),
    payload,
    SCHEDULE_PENDING_CACHE_CONFIG.ttlSeconds
  );
}

function loadSchedulePendingRecords_(sourceId) {
  const payload = CacheService.getScriptCache().get(buildSchedulePendingCacheKey_(sourceId));
  if (!payload) return null;

  try {
    const parsed = JSON.parse(payload);
    if (!Array.isArray(parsed)) return null;

    return parsed.map(function (item) {
      return {
        date: new Date(item.dateMs),
        start: new Date(item.startMs),
        end: item.endMs ? new Date(item.endMs) : null,
        place: item.place,
        memo1: item.memo1,
        memo2: item.memo2 || '',
        link: item.link || ''
      };
    });
  } catch (err) {
    Log.debug(`⚠️ schedule pending cache parse failed: ${err.message}`);
    return null;
  }
}

function clearSchedulePendingRecords_(sourceId) {
  CacheService.getScriptCache().remove(buildSchedulePendingCacheKey_(sourceId));
}

// ---------- メッセージ生成 ----------

// 確認カードに並べる予定の数（多いと LINE のカードの大きさの上限をこえるため）。登録はすべてする
const SCHEDULE_CONFIRM_CARD_MAX_ROWS_ = 15;

const SCHEDULE_REGISTRATION_EXAMPLE_ =
  '書き方（1行に1件）:\n#予定登録\n11月2日 15:00〜17:00 灘崎総合公園 フットサル\n11/3 9:00〜 体育館 大会\n（最後の行にURLを書くと、参加リンクになります）';

function scheduleQuickReply_(items) {
  return { items: items };
}

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

  saveSchedulePendingRecords_(sourceId, records);

  // 読み取った予定は一覧のカードで見せる。登録・キャンセルは1回きりなので、カードのボタンにせずクイックリプライにする
  const card = createScheduleConfirmFlexMessage_(records, {
    link: parsedResult.link,
    autoFilledCount: monthlyAutoFilledCount,
    errors: errors
  });
  card.sender = SENDERS.Auto;
  card.quickReply = scheduleQuickReply_([
    LINE_func.createQuickReply('登録する', { text: '#予定確定' }),
    LINE_func.createQuickReply('キャンセル', { text: '#予定キャンセル' })
  ]);
  return [card];
}

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
    text: `登録するときは「登録する」を押すか、「#予定確定」と送ってください（${minutes}分たつと取り消されます）。`,
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

/**
 * 登録待ちをシートに書く。「登録する」を続けて押して2つ同時に動いても、
 * 同じ予定を2回書かないよう、ロックの中で「読む → 書く → 消す」をする
 */
function createScheduleConfirmMessages_(event) {
  const sourceId = resolveScheduleSourceId_(event);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SCHEDULE_PENDING_CACHE_CONFIG.confirmLockWaitMs)) {
    return [{
      type: 'text',
      text: '⚠️ ほかの登録の途中です。少し待ってから「#予定確定」を送ってください。',
      sender: SENDERS.Error,
      quickReply: scheduleQuickReply_([LINE_func.createQuickReply('登録する', { text: '#予定確定' })])
    }];
  }

  let records;
  try {
    records = loadSchedulePendingRecords_(sourceId);
    if (records && records.length) {
      appendScheduleRecordsToSheet_(records);
      clearSchedulePendingRecords_(sourceId);
    }
  } finally {
    lock.releaseLock();
  }

  // 古い「登録する」が押されたときも黙らない（済んだか、時間がたって消えたか）
  if (!records || !records.length) {
    return [{
      type: 'text',
      text: '登録待ちの予定はありません（登録が済んだか、時間がたって取り消されました）。\n新しく登録するときは「#予定登録」からどうぞ。',
      sender: SENDERS.Auto,
      quickReply: scheduleQuickReply_([ACTIONS.Plan, ACTIONS.Admin])
    }];
  }

  extractUpcomingRecordsWithDateObjects(true);

  const confirmMessage = {
    type: 'text',
    text: `✅ ${records.length}件登録しました。`,
    sender: SENDERS.Auto
  };

  return [confirmMessage].concat(createAutoReminderFlexMessages_());
}

function createScheduleCancelMessages_(event) {
  const sourceId = resolveScheduleSourceId_(event);
  clearSchedulePendingRecords_(sourceId);

  return [{
    type: 'text',
    text: 'キャンセルしました。',
    sender: SENDERS.Auto,
    quickReply: scheduleQuickReply_([ACTIONS.Plan, ACTIONS.Admin])
  }];
}

function formatScheduleErrors_(errors) {
  return errors.map(function (error) {
    return `　${error.lineNumber}行目: 「${error.raw.trim()}」`;
  }).join('\n');
}
