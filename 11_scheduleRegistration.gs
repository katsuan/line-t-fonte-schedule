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

function createScheduleRegistrationMessages_(text, event) {
  const sourceId = resolveScheduleSourceId_(event);
  const parsedResult = parseScheduleRegistrationLines_(text);
  const records = parsedResult.records;
  const errors = parsedResult.errors;

  if (!records.length) {
    return [{
      type: 'text',
      text: errors.length
        ? `⚠️ 読み取れる予定がありませんでした。\n${formatScheduleErrors_(errors)}`
        : '⚠️「#予定登録」の下に、予定を1行ずつ入力してください。',
      sender: SENDERS.Error
    }];
  }

  const monthlyAutoFilledCount = applyExistingMonthlyLinkFallback_(records);

  saveSchedulePendingRecords_(sourceId, records);

  const messageLines = [`📝 ${records.length}件読み取りました。この内容で登録しますか？`]
    .concat(buildScheduleTableLines_(records));

  if (parsedResult.link) {
    messageLines.push('');
    messageLines.push(`🔗 参加リンク（未指定の行に適用）: ${parsedResult.link}`);
  }

  if (monthlyAutoFilledCount) {
    messageLines.push('');
    messageLines.push(`🔗 ${monthlyAutoFilledCount}件は同月の既存予定からリンクを自動補完しました。`);
  }

  if (errors.length) {
    messageLines.push('');
    messageLines.push('⚠️ 読み取れなかった行:');
    messageLines.push(formatScheduleErrors_(errors));
  }

  return [{
    type: 'text',
    text: messageLines.join('\n'),
    sender: SENDERS.Auto,
    quickReply: {
      items: [
        LINE_func.createQuickReply('登録する', { text: '#予定確定' }),
        LINE_func.createQuickReply('キャンセル', { text: '#予定キャンセル' })
      ]
    }
  }];
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
      sender: SENDERS.Error
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

  if (!records || !records.length) {
    return [{
      type: 'text',
      text: '⚠️ 登録待ちの予定が見つかりません。「#予定登録」からやり直してください。',
      sender: SENDERS.Error
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
    sender: SENDERS.Auto
  }];
}

/**
 * Plan シートの列（date/start/end/place/memo1/memo2/link）と1:1で見せる。
 * LINEはmarkdownを描画しないため罫線としては揃わないが、区切り文字としてこの書式を使う
 */
function buildScheduleTableLines_(records) {
  const header = '|#|date|start|end|place|memo1|memo2|link|';
  const separator = '|---|---|---|---|---|---|---|---|';
  const rows = records.map(function (record, index) {
    return formatScheduleTableRow_(record, index + 1);
  });

  return [header, separator].concat(rows);
}

function formatScheduleTableRow_(record, index) {
  const dateLabel = _formatDate_(record.date, FORMAT.Date);
  const startLabel = _formatDate_(record.start, FORMAT.Time);
  const endLabel = record.end ? _formatDate_(record.end, FORMAT.Time) : '';
  const linkLabel = record.link ? '🔗' : '';
  return `|${index}|${dateLabel}|${startLabel}|${endLabel}|${record.place}|${record.memo1}|${record.memo2}|${linkLabel}|`;
}

function formatScheduleErrors_(errors) {
  return errors.map(function (error) {
    return `　${error.lineNumber}行目: 「${error.raw.trim()}」`;
  }).join('\n');
}
