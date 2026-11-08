// ==========[ 施設の空き状況：「#灘崎」「#灘崎 19-21」「#灘崎 土日」にカードで返す ]==========

/**
 * ============================================================================
 * Availability Service（施設の空き状況）
 * ----------------------------------------------------------------------------
 * 役割:
 * - 「#灘崎」のようなメッセージに、施設の2週間分の空き状況をカードで返す
 * - 「#灘崎 19-21」で時間帯、「#灘崎 土日」で曜日をしぼる（組み合わせられる）
 * - 岡山市施設予約サービスの空き状況ページが裏で使っている API（GetDay）から取る
 * - 予約サイトはカードの下のボタンで開く
 *
 * このファイルだけで動く（ほかのファイルからは Log だけを使う）。同じものを2か所に置いている:
 * - GAS_assistant（ひしょっと）30_domain/05_availability_service.gs … 元
 * - line-t-fonte-schedule（T-FONTE）15_availability.gs … 写し
 * 直すときは元を直して、写しにそのままコピーする（中身は同じにする）。
 * 入口は2つ: isAvailabilityText(text)（当てはまるか）と handleAvailabilityText(text)（返事）
 * ============================================================================
 */

/**
 * 「#灘崎」のように送ると空き状況を返す施設。
 * facility と room は岡山市施設予約サービスの空き状況ページの URL
 * （/FacilityAvailability/Index/<facility>?...&rc=<room>）から取る。
 */
const AVAILABILITY_FACILITIES = Object.freeze([
  { key: '灘崎', name: '灘崎町総合公園 フットサルコート', facility: '331007/0029', room: '121' },
]);

const AVAILABILITY_BASE_URL = 'https://yoyacool.e-harp.jp/okayamacity/FacilityAvailability';
const AVAILABILITY_DAYS = 14;

/** 空きとして出す状態 */
const AVAILABILITY_OPEN_STATUSES = Object.freeze(['利用可能', '空き状況のみ']);

/** サイトの状態コード（ページ内の STATUS_TYPES より） */
const AVAILABILITY_STATUS_LABELS = Object.freeze({
  A01: '利用可能',
  A02: '空き状況のみ',
  A03: '電話受付',
  L01: '抽選申込可',
  L02: '抽選申込可',
  L03: '抽選待ち',
  R03: '空きなし',
  U01: '休館日',
  U02: '公開前',
  U03: '受付前',
  U04: '公開終了',
  U05: '受付終了',
  U07: '利用不可',
  U08: '一般開放',
  U09: '設備保守',
  U10: '窓口受付',
});

const AVAILABILITY_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 「#灘崎」「＃ 灘崎」「#灘崎 19-21」「#灘崎 土日」「#灘崎 土日 19-21」から施設・時間帯・曜日を取り出す。
 * 当てはまらなければ null。施設のあとが読めないときは badOption を true にする（書き方を返すため）。
 *
 * @param {string} text
 * @returns {{facility: Object, window: ({start: number, end: number}|null), days: (number[]|null), badOption: boolean}|null}
 */
function detectAvailabilityFacility_(text) {
  const match = String(text || '').trim().match(/^[#＃]\s*(\S+)(?:[\s　]+(.+))?$/u);
  if (!match) return null;
  const facility = AVAILABILITY_FACILITIES.find(function (f) { return f.key === match[1]; });
  if (!facility) return null;

  const request = { facility: facility, window: null, days: null, badOption: false };
  String(match[2] || '').split(/[\s　、,]+/).filter(Boolean).forEach(function (token) {
    const days = parseAvailabilityDays_(token);
    const window = days ? null : parseAvailabilityWindow_(token);
    if (days && !request.days) request.days = days;
    else if (window && !request.window) request.window = window;
    else request.badOption = true;
  });
  return request;
}

/**
 * 「土日」「土」「月水金」「火曜」「平日」「週末」を曜日の番号（日=0〜土=6）にする。読めなければ null。
 * 祝日は見分けない。
 *
 * @param {string} text
 * @returns {number[]|null}
 */
function parseAvailabilityDays_(text) {
  const t = String(text || '').replace(/曜日?/g, '');
  if (t === '平日') return [1, 2, 3, 4, 5];
  if (t === '週末') return [0, 6];
  if (!/^[月火水木金土日]+$/u.test(t)) return null;
  return t.split('').map(function (c) { return AVAILABILITY_WEEKDAYS.indexOf(c); })
    .filter(function (n, i, all) { return all.indexOf(n) === i; });
}

/** [0, 6] → 「土日」、平日5つ → 「平日」 */
function formatAvailabilityDays_(days) {
  if (days.length === 5 && [1, 2, 3, 4, 5].every(function (d) { return days.indexOf(d) >= 0; })) return '平日';
  return days.slice().sort(function (x, y) { return (x || 7) - (y || 7); })
    .map(function (d) { return AVAILABILITY_WEEKDAYS[d]; }).join('');
}

/** その日が、しぼった曜日に入るか（しぼっていなければいつも true） */
function isAvailabilityDay_(date, days) {
  return !days || days.indexOf(new Date(`${date}T00:00:00Z`).getUTCDay()) >= 0;
}

/**
 * 「19-21」「19〜21時」「19時-21時」「１９－２１」「19:30-21」を、0時からの分にする。読めなければ null。
 *
 * @param {string} text
 * @returns {{start: number, end: number}|null}
 */
function parseAvailabilityWindow_(text) {
  const normalized = String(text || '')
    .replace(/[０-９：]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[〜～ー－−–—]/g, '-')
    .replace(/[時\s　]/g, '');
  const m = normalized.match(/^(\d{1,2})(?::(\d{2}))?-(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2] || 0);
  const end = Number(m[3]) * 60 + Number(m[4] || 0);
  if (start >= end || end > 24 * 60) return null;
  return { start: start, end: end };
}

/**
 * 登録済みの施設の「#灘崎」なら true。
 * 名前の後ろに _ を付けないのは、ライブラリの外（親のボット）から呼べるようにするため。
 *
 * @param {string} text
 * @returns {boolean}
 */
function isAvailabilityText(text) {
  return Boolean(detectAvailabilityFacility_(text));
}

/**
 * 「#灘崎 …」への返事（LINE のメッセージの配列）。当てはまらなければ null。
 *
 * @param {string} text
 * @param {Date=} now
 * @returns {Object[]|null}
 */
function handleAvailabilityText(text, now) {
  const request = detectAvailabilityFacility_(text);
  return request ? handleAvailabilityCommand_(request, now) : null;
}

/**
 * 空き状況を取ってカードにする。時間帯・曜日があれば、そこだけにしぼる。
 *
 * @param {{facility: Object, window: ({start: number, end: number}|null), days: (number[]|null), badOption: boolean}} request
 * @param {Date=} now
 * @returns {Object[]}
 */
function handleAvailabilityCommand_(request, now) {
  const facility = request.facility;
  if (request.badOption) {
    return [{
      type: 'text',
      text: [
        '書き方の例:',
        `#${facility.key} … 2週間の空き`,
        `#${facility.key} 19-21 … 19〜21時の空き`,
        `#${facility.key} 土日 … 土日の空き（平日・月水金 なども）`,
        `#${facility.key} 土日 19-21 … 両方でしぼる`,
      ].join('\n'),
    }];
  }

  const at = now || new Date();
  const range = getAvailabilityRange_(at);
  const pageUrl = buildAvailabilityPageUrl_(facility, range);
  const title = `${buildAvailabilityLabel_(request)}空き状況`;

  let days;
  try {
    const slots = toAvailabilitySlots_(fetchAvailability_(facility, range))
      .filter(function (slot) { return isAvailabilityDay_(slot.date, request.days); });
    days = collectAvailabilityDays_(slots, request.window);
  } catch (err) {
    // 中身はログにだけ残し、LINE にはやさしい言葉とリンクだけを返す
    logAvailabilityError_(err);
    return [{
      type: 'text',
      text: `【${facility.name}】${title}を、いまは取れませんでした。\nサイトで見てください:\n${pageUrl}`,
    }];
  }

  return [buildAvailabilityCard_({
    facility: facility,
    title: title,
    asOf: Utilities.formatDate(at, 'Asia/Tokyo', 'M/d HH:mm'),
    window: request.window,
    days: days,
    pageUrl: pageUrl,
  })];
}

/** 取れなかったわけを残す。Log に error がない環境でも止まらない */
function logAvailabilityError_(err) {
  const detail = { where: 'availability', detail: String((err && err.stack) || err) };
  if (typeof Log !== 'undefined' && Log && typeof Log.error === 'function') Log.error(detail);
  else console.error(JSON.stringify(detail));
}

/** 「土日 19-21時の」「土曜の」「」 */
function buildAvailabilityLabel_(request) {
  const labels = [];
  if (request.days) {
    const days = formatAvailabilityDays_(request.days);
    labels.push(days.length === 1 ? `${days}曜` : days);
  }
  if (request.window) labels.push(formatAvailabilityWindow_(request.window));
  return labels.length ? `${labels.join(' ')}の` : '';
}

/**
 * 日本時間の今日から2週間。
 *
 * @param {Date} now
 * @returns {{start: string, end: string}}
 */
function getAvailabilityRange_(now) {
  const day = function (offset) {
    return Utilities.formatDate(new Date(now.getTime() + offset * 86400000), 'Asia/Tokyo', 'yyyy-MM-dd');
  };
  return { start: day(0), end: day(AVAILABILITY_DAYS - 1) };
}

/** 空き状況ページ（人が見る方）の URL */
function buildAvailabilityPageUrl_(facility, range) {
  return `${AVAILABILITY_BASE_URL}/Index/${facility.facility}` +
    `?ptn=3&d=${range.start}&rc=${facility.room}&sd=${range.start}&rc2w=${facility.room}&ed=${range.end}`;
}

/**
 * @param {Object} facility
 * @param {{start: string, end: string}} range
 * @returns {Object} GetDay の応答
 */
function fetchAvailability_(facility, range) {
  const response = UrlFetchApp.fetch(`${AVAILABILITY_BASE_URL}/GetDay/${facility.facility}`, {
    method: 'post',
    contentType: 'application/json;charset=UTF-8',
    headers: { Accept: 'application/json' },
    payload: JSON.stringify({
      startDate: range.start,
      endDate: range.end,
      roomCode: facility.room,
      period: AVAILABILITY_DAYS,
    }),
    muteHttpExceptions: true,
  });
  const statusCode = response.getResponseCode();
  if (statusCode !== 200) {
    throw new Error(`サイトの応答 ${statusCode}`);
  }
  const data = JSON.parse(response.getContentText() || '{}');
  if (!Array.isArray(data.rooms)) {
    throw new Error('空き状況の形が想定と違います');
  }
  return data;
}

/**
 * GetDay の応答を1枠ずつの配列にする。
 *
 * @param {Object} data
 * @returns {Array<{room: string, date: string, start: string, end: string, status: string}>}
 */
function toAvailabilitySlots_(data) {
  const frames = {};
  (data.timeFrames || []).forEach(function (set) {
    (set.usageTimeFrames || []).forEach(function (f) {
      frames[f.usageTimeFrameId] = { start: f.usageStartTime.slice(0, 5), end: f.usageEndTime.slice(0, 5) };
    });
  });

  const slots = [];
  data.rooms.forEach(function (room) {
    (room.courts || []).forEach(function (court) {
      const name = [room.roomName, court.courtName].filter(Boolean).join(' ');
      (court.dayBooks || []).forEach(function (book) {
        const date = String(book.usageDate || '').slice(0, 10);
        (book.usageTimes || []).forEach(function (u) {
          const frame = frames[u.usageTimeFrameId];
          if (!frame || !date) return;
          slots.push({
            room: name,
            date: date,
            start: frame.start,
            end: frame.end,
            status: AVAILABILITY_STATUS_LABELS[u.statusType] || u.statusType || '不明',
          });
        });
      });
    });
  });
  return slots;
}

/** 「19:30」→ 1170（0時からの分） */
function toAvailabilityMinutes_(hhmm) {
  const parts = hhmm.split(':').map(Number);
  return parts[0] * 60 + (parts[1] || 0);
}

/** 1170 → 「19:30」、1140 → 「19」 */
function formatAvailabilityMinutes_(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}:${String(m).padStart(2, '0')}` : `${h}`;
}

/** {start: 1140, end: 1260} → 「19-21時」 */
function formatAvailabilityWindow_(window) {
  return `${formatAvailabilityMinutes_(window.start)}-${formatAvailabilityMinutes_(window.end)}時`;
}

/**
 * 1行を短くするため、どのコートにも付いている部屋の名前（「フットサルコート 」）を省く。
 *
 * @param {string[]} rooms
 * @returns {function(string): string}
 */
function shortAvailabilityRoomLabel_(rooms) {
  const head = rooms.length ? rooms[0].split(' ')[0] + ' ' : '';
  const shared = head.trim() && rooms.every(function (r) { return r.indexOf(head) === 0 && r.length > head.length; });
  return function (room) { return shared ? room.slice(head.length) : room; };
}

/**
 * 日ごと・コートごとに、空いている時間をまとめる。
 * 時間帯があれば、その中だけを見て、まるごと空いているか（whole）も調べる。
 * 「空き状況のみ」（ネットからは予約できない枠）は、ふつうの空きと分けて viewOnly を付ける。
 *
 * @param {Object[]} slots toAvailabilitySlots_ の戻り値
 * @param {{start: number, end: number}|null} window
 * @returns {{courts: string[], days: Array<{date: string, label: string, open: boolean, cells: Object, reason: string}>}}
 *   cells は コート名 → {whole: boolean, spans: Array<{start: number, end: number, viewOnly: boolean}>}
 */
function collectAvailabilityDays_(slots, window) {
  const from = window ? window.start : 0;
  const to = window ? window.end : 24 * 60;
  const byDate = {};
  const rooms = [];
  slots.forEach(function (s) {
    if (rooms.indexOf(s.room) < 0) rooms.push(s.room);
    const start = Math.max(toAvailabilityMinutes_(s.start), from);
    const end = Math.min(toAvailabilityMinutes_(s.end), to);
    if (start >= end) return;
    (byDate[s.date] = byDate[s.date] || []).push({ room: s.room, start: start, end: end, status: s.status });
  });
  rooms.sort();
  const label = shortAvailabilityRoomLabel_(rooms);

  const days = Object.keys(byDate).sort().map(function (date) {
    const rows = byDate[date];
    const d = new Date(`${date}T00:00:00Z`);
    const cells = {};
    rooms.forEach(function (room) {
      const open = rows
        .filter(function (r) { return r.room === room && AVAILABILITY_OPEN_STATUSES.includes(r.status); })
        .sort(function (a, b) { return a.start - b.start; });
      if (open.length === 0) return;

      const spans = [];
      open.forEach(function (r) {
        const viewOnly = r.status !== '利用可能';
        const last = spans[spans.length - 1];
        if (last && last.end === r.start && last.viewOnly === viewOnly) last.end = r.end;
        else spans.push({ start: r.start, end: r.end, viewOnly: viewOnly });
      });
      let covered = from;
      spans.forEach(function (sp) { if (sp.start <= covered) covered = Math.max(covered, sp.end); });
      cells[label(room)] = { whole: Boolean(window) && covered >= to, spans: spans };
    });

    const reasons = rows.map(function (r) { return r.status; })
      .filter(function (x, i, a) { return x !== '空きなし' && !AVAILABILITY_OPEN_STATUSES.includes(x) && a.indexOf(x) === i; });
    return {
      date: date,
      label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${AVAILABILITY_WEEKDAYS[d.getUTCDay()]})`,
      open: Object.keys(cells).length > 0,
      cells: cells,
      reason: reasons.length ? `空きなし（${reasons.join('・')}）` : '空きなし',
    };
  });
  return { courts: rooms.map(label), days: days };
}

/**
 * 続けて空きなしで、理由も同じ日を1つにまとめる（「11/16(月)〜11/21(土) 空きなし（設備保守）」）。
 *
 * @param {Object[]} days
 * @returns {Object[]}
 */
function groupClosedAvailabilityDays_(days) {
  const out = [];
  days.forEach(function (day) {
    const last = out[out.length - 1];
    if (!day.open && last && !last.open && last.reason === day.reason) {
      last.lastLabel = day.label;
    } else {
      out.push(Object.assign({}, day));
    }
  });
  return out;
}

/** 「7-10, 12-17時」。分があれば「7:30-9時」 */
function formatAvailabilitySpans_(spans) {
  return spans.map(function (sp) {
    return `${formatAvailabilityMinutes_(sp.start)}-${formatAvailabilityMinutes_(sp.end)}`;
  }).join(', ') + '時';
}

/**
 * 空き状況のカード。コートを列にした表で、左に日付。
 * ネットで予約できる日はうすい緑の背景、「空き状況のみ」だけの日はうすい灰色、続けて空きなしの日は1行にまとめて灰色の字。
 * 下のボタンで予約サイトを開く（あとで押されても困らない、ただのリンク）。
 *
 * @param {{facility: Object, title: string, asOf: string, window: Object|null, days: Object, pageUrl: string}} card
 *   days は collectAvailabilityDays_ の戻り値
 * @returns {Object}
 */
function buildAvailabilityCard_(card) {
  const dark = '#111111';
  const sub = '#666666';
  const faint = '#999999';
  const open = '#0F7A5A';
  const openBg = '#EAF5F0';
  const viewOnlyBg = '#F3F3F3';
  const courts = card.days.courts;
  const days = card.days.days;
  const dateWidth = '72px';

  const hasViewOnly = days.some(function (day) {
    return Object.keys(day.cells).some(function (k) { return day.cells[k].spans.some(function (sp) { return sp.viewOnly; }); });
  });
  const legend = [];
  if (card.window) legend.push('○ まるごと空き　△ 一部だけ空き');
  if (hasViewOnly) legend.push('緑 … ネットで予約できる　※ 灰色 … 空き状況のみ');

  const head = [
    { type: 'text', text: card.facility.name, weight: 'bold', size: 'md', color: dark, wrap: true },
    { type: 'text', text: `${card.title}（${card.asOf} 時点）`, size: 'xs', color: sub, wrap: true, margin: 'sm' },
  ];
  legend.forEach(function (text) {
    head.push({ type: 'text', text: text, size: 'xxs', color: faint, wrap: true, margin: 'xs' });
  });

  // 見出しの行の左はしは空けておく（LINE は空の文字を受け付けないので、中身のない箱にする）
  const dateCell = function (text, color, weight) {
    return {
      type: 'box', layout: 'vertical', width: dateWidth, flex: 0,
      contents: text ? [{ type: 'text', text: text, size: 'sm', color: color, weight: weight || 'regular' }] : [],
    };
  };
  // 背景のある行とない行で、左の位置をそろえる（どの行も左右 8px あける）
  const row = function (contents, margin, backgroundColor) {
    const box = {
      type: 'box', layout: 'horizontal', spacing: 'md', margin: margin || 'md',
      paddingStart: '8px', paddingEnd: '8px', contents: contents,
    };
    if (backgroundColor) {
      box.backgroundColor = backgroundColor;
      box.cornerRadius = '4px';
      box.paddingTop = '8px';
      box.paddingBottom = '8px';
    }
    return box;
  };

  const table = [];
  if (courts.length > 1 && days.some(function (day) { return day.open; })) {
    table.push(row([dateCell('', faint)].concat(courts.map(function (name) {
      return { type: 'text', text: name, size: 'xs', color: sub, flex: 1 };
    })), 'lg'));
  }

  groupClosedAvailabilityDays_(days).forEach(function (day, i) {
    const margin = i === 0 && courts.length <= 1 ? 'lg' : 'md';
    if (!day.open) {
      const label = day.lastLabel ? `${day.label}〜${day.lastLabel}` : day.label;
      table.push(row([{ type: 'text', text: `${label}　${day.reason}`, size: 'sm', color: faint, wrap: true }], margin));
      return;
    }
    table.push(row([dateCell(day.label, dark, 'bold')].concat(courts.map(function (name) {
      return buildAvailabilityCell_(day.cells[name], card.window, open, faint);
    })), margin === 'lg' ? 'lg' : 'sm', hasBookable_(day) ? openBg : viewOnlyBg));
  });
  if (days.length === 0) {
    table.push({ type: 'text', text: 'この条件の日はありません', size: 'sm', color: faint, wrap: true, margin: 'lg' });
  }

  const openDays = days.filter(function (day) { return day.open; }).map(function (day) { return day.label; });
  const altText = `【${card.facility.name}】${card.title}` +
    (openDays.length ? `　空きのある日: ${openDays.join(' ')}` : '　空きなし');

  return { type: 'flex', altText: altText.slice(0, 400), contents: {
    type: 'bubble',
    size: 'giga',
    body: { type: 'box', layout: 'vertical', contents: head.concat(table) },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [{
        type: 'button',
        style: 'link',
        height: 'sm',
        action: { type: 'uri', label: '予約サイトで見る', uri: card.pageUrl },
      }],
    },
  } };
}

/** その日に、ネットで予約できる空きがあるか */
function hasBookable_(day) {
  return Object.keys(day.cells).some(function (k) {
    return day.cells[k].whole && !day.cells[k].spans.some(function (sp) { return sp.viewOnly; }) ||
      day.cells[k].spans.some(function (sp) { return !sp.viewOnly; });
  });
}

/**
 * 表の1マス。空きなしは「—」。ネットで予約できる時間は緑、「空き状況のみ」は灰色。
 * 時間帯つきなら「○」（まるごと空き）か「△ 19-20時」、なければ「7-17時」。「空き状況のみ」の時間は薄く ※ を付ける。
 */
function buildAvailabilityCell_(cell, window, open, faint) {
  if (!cell) return { type: 'text', text: '—', size: 'sm', color: faint, flex: 1 };

  const booked = cell.spans.filter(function (sp) { return !sp.viewOnly; });
  const viewOnly = cell.spans.filter(function (sp) { return sp.viewOnly; });
  const parts = [];
  if (window) parts.push({ type: 'span', text: cell.whole ? '○' : '△', color: booked.length || cell.whole && !viewOnly.length ? open : faint, weight: 'bold' });
  if (!cell.whole) {
    if (booked.length) parts.push({ type: 'span', text: `${parts.length ? ' ' : ''}${formatAvailabilitySpans_(booked)}`, color: open, weight: 'bold' });
    if (viewOnly.length) {
      const lead = parts.length ? (booked.length ? ', ' : ' ') : '';
      parts.push({ type: 'span', text: `${lead}${formatAvailabilitySpans_(viewOnly)}※`, color: faint });
    }
  } else if (viewOnly.length) {
    parts.push({ type: 'span', text: '※', color: faint });
  }
  return { type: 'text', size: 'sm', wrap: true, flex: 1, contents: parts };
}
