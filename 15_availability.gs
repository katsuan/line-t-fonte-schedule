// ==========[ 施設の空き状況：「#灘崎」「#灘崎 19-21」「#灘崎 土日」にカードで返す ]==========

/**
 * ============================================================================
 * Availability Service（施設の空き状況）
 * ----------------------------------------------------------------------------
 * 役割:
 * - 「#灘崎」のようなメッセージに、施設の2週間分の空き状況をカードで返す
 * - 「#灘崎 19-21」で時間帯、「#灘崎 土日」で曜日をしぼる。「#灘崎 次」で次の2週間（組み合わせられる）
 * - 岡山市施設予約サービスの空き状況ページが裏で使っている API（GetDay）から取る
 * - 予約サイトはカードの下のボタンで開く
 *
 * このファイルだけで動く（ほかのファイルからは Log だけを使う）。
 * ボットに listAvailabilityActivities_(facility, range) があれば、その施設での活動の予定を ⚽ で出す（T-FONTE だけが置いている）。
 * 同じものを2か所に置いている:
 * - GAS_assistant（ひしょっと）30_domain/05_availability_service.gs … 元
 * - line-t-fonte-schedule（T-FONTE）15_availability.gs … 写し
 * 直すときは元を直して、写しにそのままコピーする（中身は同じにする）。
 * 入口: isAvailabilityText(text)（当てはまるか）・handleAvailabilityText(text)（返事）・handleAvailabilityDigest(text)（これからの空きを1通。なければなし）
 * ============================================================================
 */

/**
 * 「#灘崎」のように送ると空き状況を返す施設。
 * placeWords は、活動の予定の場所にこの言葉が入っていればこの施設とみなす言葉（listAvailabilityActivities_ を置いたボットだけが使う）。
 * facility と room は岡山市施設予約サービスの空き状況ページの URL
 * （/FacilityAvailability/Index/<facility>?...&rc=<room>）から取る。
 */
const AVAILABILITY_FACILITIES = Object.freeze([
  { key: '灘崎', name: '灘崎町総合公園 フットサルコート', facility: '331007/0029', room: '121', placeWords: ['灘崎'] },
]);

const AVAILABILITY_BASE_URL = 'https://yoyacool.e-harp.jp/okayamacity/FacilityAvailability';
const AVAILABILITY_DAYS = 14;

/** これからの空き（handleAvailabilityDigest）で見る日数。サイトは1回で90日ぶん返す（先は「受付前」のことが多い） */
const AVAILABILITY_DIGEST_DAYS = 90;

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
 * 「#灘崎」「＃ 灘崎」「#灘崎 19-21」「#灘崎 土日」「#灘崎 次」「#灘崎 次 土日 19-21」から施設・時間帯・曜日・何回先の2週間かを取り出す。
 * 当てはまらなければ null。施設のあとが読めないときは badOption を true にする（書き方を返すため）。
 *
 * @param {string} text
 * @returns {{facility: Object, window: ({start: number, end: number}|null), days: (number[]|null), page: number, badOption: boolean}|null}
 */
function detectAvailabilityFacility_(text) {
  const match = String(text || '').trim().match(/^[#＃]\s*(\S+)(?:[\s　]+(.+))?$/u);
  if (!match) return null;
  const facility = AVAILABILITY_FACILITIES.find(function (f) { return f.key === match[1]; });
  if (!facility) return null;

  const request = { facility: facility, window: null, days: null, page: 0, badOption: false };
  String(match[2] || '').split(/[\s　、,]+/).filter(Boolean).forEach(function (token) {
    const page = parseAvailabilityPage_(token);
    const days = page ? null : parseAvailabilityDays_(token);
    const window = page || days ? null : parseAvailabilityWindow_(token);
    if (page && !request.page) request.page = page;
    else if (days && !request.days) request.days = days;
    else if (window && !request.window) request.window = window;
    else request.badOption = true;
  });
  return request;
}

/** 曜日の番号のほかに、祝日を表す番号（日=0〜土=6 のつぎ） */
const AVAILABILITY_HOLIDAY = 7;

/** 先の2週間を何回まで出すか（サイトは先の予約をまだ受け付けていないことが多い） */
const AVAILABILITY_MAX_PAGE = 4;

/**
 * 「次」「次の2週間」→ 1（次の2週間）、「次の次」→ 2。読めなければ 0。
 *
 * @param {string} text
 * @returns {number}
 */
function parseAvailabilityPage_(text) {
  const t = String(text || '').replace(/の?2週間$/, '');
  if (!/^次(の次)*$/.test(t)) return 0;
  return Math.min(t.split('次').length - 1, AVAILABILITY_MAX_PAGE);
}

/** 1 → 「次」、2 → 「次の次」（ボタンで送る文に使う） */
function formatAvailabilityPage_(page) {
  return Array(page).fill('次').join('の');
}

/**
 * 「土日」「土日祝」「土」「月水金」「火曜」「平日」「週末」「休日」を曜日の番号（日=0〜土=6、祝日=7）にする。読めなければ null。
 *
 * @param {string} text
 * @returns {number[]|null}
 */
function parseAvailabilityDays_(text) {
  const t = String(text || '').replace(/曜日?/g, '');
  if (t === '平日') return [1, 2, 3, 4, 5];
  if (t === '週末') return [0, 6];
  if (t === '休日') return [0, 6, AVAILABILITY_HOLIDAY];
  if (!/^[月火水木金土日祝]+$/u.test(t)) return null;
  return t.split('').map(function (c) { return c === '祝' ? AVAILABILITY_HOLIDAY : AVAILABILITY_WEEKDAYS.indexOf(c); })
    .filter(function (n, i, all) { return all.indexOf(n) === i; });
}

/** [0, 6] → 「土日」、[0, 6, 7] → 「土日祝」、平日5つ → 「平日」 */
function formatAvailabilityDays_(days) {
  if (days.length === 5 && [1, 2, 3, 4, 5].every(function (d) { return days.indexOf(d) >= 0; })) return '平日';
  const order = function (d) { return d === 0 ? 7 : d === AVAILABILITY_HOLIDAY ? 8 : d; };
  return days.slice().sort(function (x, y) { return order(x) - order(y); })
    .map(function (d) { return d === AVAILABILITY_HOLIDAY ? '祝' : AVAILABILITY_WEEKDAYS[d]; }).join('');
}

/** その日が、しぼった曜日に入るか（しぼっていなければいつも true）。「祝」をしぼったときは、祝日も入る */
function isAvailabilityDay_(date, days, holidays) {
  if (!days) return true;
  if (days.indexOf(new Date(`${date}T00:00:00Z`).getUTCDay()) >= 0) return true;
  return days.indexOf(AVAILABILITY_HOLIDAY) >= 0 && Boolean(holidays && holidays[date]);
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
 * これからの空き。「#灘崎 19-21」なら、今日から AVAILABILITY_DIGEST_DAYS 日ぶんで、19〜21時に空きのある日だけのカードを1通。
 * 空きがない・取れないときは何も返さない（ほかの返事のうしろに足して使うので、じゃまをしない）。
 * 名前の後ろに _ を付けないのは、ライブラリの外（親のボット）から呼べるようにするため。
 *
 * @param {string} text
 * @param {Date=} now
 * @returns {Object[]} 0通か1通
 */
function handleAvailabilityDigest(text, now) {
  const request = detectAvailabilityFacility_(text);
  if (!request || request.badOption) return [];
  request.spanDays = AVAILABILITY_DIGEST_DAYS;
  request.page = 0;
  request.onlyOpen = true;
  request.maxMessages = 1;
  const messages = handleAvailabilityCommand_(request, now);
  return messages.filter(function (m) { return m.type === 'flex'; }).slice(0, 1);
}

/**
 * 空き状況を取ってカードにする。時間帯・曜日があれば、そこだけにしぼる。
 *
 * @param {{facility: Object, window: ({start: number, end: number}|null), days: (number[]|null), page: number, badOption: boolean,
 *   spanDays: (number|undefined), onlyOpen: (boolean|undefined), maxMessages: (number|undefined)}} request
 *   spanDays … 何日ぶん見るか（ふだんは2週間）/ onlyOpen … 空きのある日だけ（なければ []）/ maxMessages … 何通までに分けてよいか
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
        `#${facility.key} 土日 … 土日の空き（土日祝・平日・月水金 なども）`,
        `#${facility.key} 土日 19-21 … 両方でしぼる`,
        `#${facility.key} 次 … 次の2週間（次の次 も）`,
      ].join('\n'),
    }];
  }

  const at = now || new Date();
  const range = getAvailabilityRange_(at, request.page, request.spanDays);
  const pageUrl = buildAvailabilityPageUrl_(facility, range);
  const title = `${buildAvailabilityLabel_(request, range)}空き状況`;

  let slots;
  let days;
  try {
    const data = fetchAvailability_(facility, range);
    const holidays = toAvailabilityHolidays_(data);
    slots = toAvailabilitySlots_(data)
      .filter(function (slot) { return isAvailabilityDay_(slot.date, request.days, holidays); });
    days = collectAvailabilityDays_(slots, request.window, holidays);
    days.activities = readAvailabilityActivities_(facility, range)
      .filter(function (a) { return isAvailabilityDay_(a.date, request.days, holidays); });
    if (request.onlyOpen) {
      days.days = days.days.filter(function (day) { return day.open; });
      if (days.days.length === 0) return [];
    }
  } catch (err) {
    // 中身はログにだけ残し、LINE にはやさしい言葉とリンクだけを返す
    logAvailabilityError_(err);
    return [{
      type: 'text',
      text: `【${facility.name}】${title}を、いまは取れませんでした。\nサイトで見てください:\n${pageUrl}`,
    }];
  }

  return buildAvailabilityCard_({
    facility: facility,
    title: title,
    asOf: Utilities.formatDate(at, 'Asia/Tokyo', 'M/d HH:mm'),
    window: request.window,
    nextText: request.spanDays ? '' : buildAvailabilityNextText_(request),
    maxMessages: request.maxMessages || 5,
    slots: slots,
    days: days,
    pageUrl: pageUrl,
  });
}

/**
 * 「次の2週間」ボタンで送る文（いまの曜日・時間帯はそのまま）。これ以上先は出さないなら ''。
 * 押されるたびにその時の空きを取るので、あとで押されても困らない。
 */
function buildAvailabilityNextText_(request) {
  if (request.page >= AVAILABILITY_MAX_PAGE) return '';
  const parts = [`#${request.facility.key}`, formatAvailabilityPage_(request.page + 1)];
  if (request.days) parts.push(formatAvailabilityDays_(request.days));
  if (request.window) parts.push(formatAvailabilityWindow_(request.window));
  return parts.join(' ');
}

/**
 * その施設での活動の予定（ボットに listAvailabilityActivities_ があるときだけ）。
 * 予定が読めなくても空き状況は返したいので、失敗したら記録して空にする。
 *
 * @param {Object} facility
 * @param {{start: string, end: string}} range
 * @returns {Array<{date: string, start: number, end: number, courts: (number[]|undefined)}>}
 *   date は 'yyyy-MM-dd'、start・end は0時からの分、courts はコートの番号（1 = ①。わからなければなし）
 */
function readAvailabilityActivities_(facility, range) {
  if (typeof listAvailabilityActivities_ !== 'function') return [];
  try {
    return (listAvailabilityActivities_(facility, range) || []).filter(function (a) {
      return a && a.date >= range.start && a.date <= range.end && a.start < a.end;
    });
  } catch (err) {
    logAvailabilityError_(err);
    return [];
  }
}

/** 活動1つの「17-19時 ①②」（コートがわからなければ時間だけ） */
function formatAvailabilityActivity_(activity) {
  const courts = (activity.courts || []).map(function (n) { return AVAILABILITY_COURT_MARKS[n - 1] || String(n); }).join('');
  return courts ? `${formatAvailabilityWindow_(activity)} ${courts}` : formatAvailabilityWindow_(activity);
}

/** 取れなかったわけを残す。Log に error がない環境でも止まらない */
function logAvailabilityError_(err) {
  const detail = { where: 'availability', detail: String((err && err.stack) || err) };
  if (typeof Log !== 'undefined' && Log && typeof Log.error === 'function') Log.error(detail);
  else console.error(JSON.stringify(detail));
}

/** 「11/22〜12/5 土日 19-21時の」「土曜の」「」（日付は次の2週間のときだけ） */
function buildAvailabilityLabel_(request, range) {
  const labels = [];
  if ((request.page || request.spanDays) && range) {
    const md = function (ymd) { const p = ymd.split('-').map(Number); return `${p[1]}/${p[2]}`; };
    labels.push(`${md(range.start)}〜${md(range.end)}`);
  }
  if (request.days) {
    const days = formatAvailabilityDays_(request.days);
    labels.push(days.length === 1 ? `${days}曜` : days);
  }
  if (request.window) labels.push(formatAvailabilityWindow_(request.window));
  return labels.length ? `${labels.join(' ')}の` : '';
}

/**
 * 日本時間の今日から2週間。page が 1 なら次の2週間（15日目から）、2 ならその次。
 *
 * @param {Date} now
 * @returns {{start: string, end: string}}
 */
function getAvailabilityRange_(now, page, spanDays) {
  const span = spanDays || AVAILABILITY_DAYS;
  const first = (page || 0) * span;
  const day = function (offset) {
    return Utilities.formatDate(new Date(now.getTime() + (first + offset) * 86400000), 'Asia/Tokyo', 'yyyy-MM-dd');
  };
  return { start: day(0), end: day(span - 1), days: span };
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
      period: range.days || AVAILABILITY_DAYS,
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
 * GetDay の応答の祝日。{ '2026-11-23': '勤労感謝の日' }
 *
 * @param {Object} data
 * @returns {Object<string, string>}
 */
function toAvailabilityHolidays_(data) {
  const out = {};
  (data.holidays || []).forEach(function (h) {
    const date = String((h && h.holidayDate) || '').slice(0, 10);
    if (date) out[date] = String(h.holidayName || '祝日');
  });
  return out;
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
 * @param {Object<string, string>=} holidays toAvailabilityHolidays_ の戻り値
 * @returns {{courts: string[], rooms: string[], days: Array<{date: string, label: string, open: boolean, cells: Object, reason: string}>}}
 *   cells は コート名 → {whole: boolean, spans: Array<{start: number, end: number, viewOnly: boolean}>}
 */
function collectAvailabilityDays_(slots, window, holidays) {
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
      label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${AVAILABILITY_WEEKDAYS[d.getUTCDay()]}${holidays && holidays[date] ? '・祝' : ''})`,
      // 日付の文字の色の種類：日曜・祝日は red、土曜は blue
      tone: (holidays && holidays[date]) || d.getUTCDay() === 0 ? 'red' : d.getUTCDay() === 6 ? 'blue' : '',
      open: Object.keys(cells).length > 0,
      cells: cells,
      reason: reasons.length ? `空きなし（${reasons.join('・')}）` : '空きなし',
    };
  });
  return { courts: rooms.map(label), rooms: rooms, days: days };
}

/**
 * 続けて空きなしで、理由も同じ日を1つにまとめる（「11/16(月)〜11/21(土) 空きなし（設備保守）」）。
 * 活動のある日（activeDates）はまとめない（⚽ を表に出すため）。暦の上で続いている日だけまとめる。
 *
 * @param {Object[]} days
 * @returns {Object[]}
 */
function groupClosedAvailabilityDays_(days, activeDates) {
  const out = [];
  days.forEach(function (day) {
    const last = out[out.length - 1];
    const active = activeDates && activeDates.indexOf(day.date) >= 0;
    // 暦の上で続いている日だけまとめる（曜日でしぼったとき、あいだの日まで入って見えないように）
    const next = last && Utilities.formatDate(new Date(new Date(`${last.lastDate || last.date}T12:00:00+09:00`).getTime() + 86400000), 'Asia/Tokyo', 'yyyy-MM-dd');
    if (!active && !day.open && last && !last.open && !last.active && last.reason === day.reason && next === day.date) {
      last.lastLabel = day.label;
      last.lastDate = day.date;
    } else {
      out.push(Object.assign({ active: active }, day));
    }
  });
  return out;
}

/** マスの色（草グラフのように、濃い緑ほど使いやすい） */
const AVAILABILITY_CELL_COLORS = Object.freeze({
  open: '#2DA44E',   // ネットで予約できる
  view: '#A8DFB8',   // 空き状況のみ（ネットでは予約できない）・一部だけ空き
  closed: '#E3E5E8', // 空きなし・設備保守など
  none: '#F7F7F7',   // 受け付けている時間の外
});

/** LINE のカードの大きさの上限（1枚 30KB・横にめくる束で 50KB）より少し小さく */
const AVAILABILITY_BUBBLE_MAX_BYTES = 28000;
const AVAILABILITY_CAROUSEL_MAX_BYTES = 48000;

const AVAILABILITY_COURT_MARKS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

/**
 * 表の列にする時間（1時間ずつ）。時間帯があればその中、なければ受け付けている時間ぜんぶ（灘崎は 7〜21時）。
 *
 * @param {Object[]} slots
 * @param {{start: number, end: number}|null} window
 * @returns {number[]} 列のはじまりの分（420 = 7時）
 */
function getAvailabilityHours_(slots, window) {
  let from = window ? Math.floor(window.start / 60) : 24;
  let to = window ? Math.ceil(window.end / 60) : 0;
  if (!window) {
    slots.forEach(function (s) {
      from = Math.min(from, Math.floor(toAvailabilityMinutes_(s.start) / 60));
      to = Math.max(to, Math.ceil(toAvailabilityMinutes_(s.end) / 60));
    });
    if (from >= to) { from = 7; to = 21; }
  }
  const hours = [];
  for (let h = from; h < to; h++) hours.push(h * 60);
  return hours;
}

/**
 * 1マス（ある日・あるコートの1時間）の状態。
 * open … まるごとネットで予約できる / view … 空いているが一部か、空き状況のみ / closed … 空きなし / none … 時間の外
 *
 * @param {Object[]} slots その日・そのコートの枠
 * @param {number} start 分
 * @param {number} end 分
 * @returns {string}
 */
function getAvailabilityCellState_(slots, start, end) {
  const inside = slots.filter(function (s) {
    return toAvailabilityMinutes_(s.start) < end && toAvailabilityMinutes_(s.end) > start;
  });
  if (inside.length === 0) return 'none';
  const open = inside.filter(function (s) { return AVAILABILITY_OPEN_STATUSES.includes(s.status); });
  if (open.length === 0) return 'closed';
  let covered = start;
  open.slice().sort(function (a, b) { return toAvailabilityMinutes_(a.start) - toAvailabilityMinutes_(b.start); })
    .forEach(function (s) {
      if (toAvailabilityMinutes_(s.start) <= covered) covered = Math.max(covered, toAvailabilityMinutes_(s.end));
    });
  const whole = covered >= end;
  const bookable = open.every(function (s) { return s.status === '利用可能'; });
  return whole && bookable ? 'open' : 'view';
}

/**
 * 空き状況のカード。草グラフのように、横に1時間ずつのマス。1日3行（日付・①・②）。日付の文字は、土曜は青、日曜・祝日は赤。
 * 空いている時間がつながるところは、最初のマスに始まり、最後のマスに終わりの時刻を書く。
 * 活動の予定があれば、日付の行に「⚽ 15-17時 ①」、その時間・そのコートのマスに ⚽ を入れる（コートがわからなければ空きなしのマスに）。
 * マスの色：濃い緑 … ネットで予約できる / うすい緑 … 空き状況のみ・一部だけ / 灰色 … 空きなし。
 * 続けて空きなしの日は「11/16(月)〜11/21(土) 空きなし（設備保守）」の1行にまとめる。
 * 大きさの上限をこえるときは、何枚かに分けて横にめくれるようにする（それでもだめなら、何通かに分けて送る）。
 * 下のボタンで予約サイトを開く（あとで押されても困らない、ただのリンク）。
 *
 * @param {{facility: Object, title: string, asOf: string, window: Object|null, slots: Object[], days: Object, pageUrl: string}} card
 *   days は collectAvailabilityDays_ の戻り値
 * @returns {Object[]} LINE のメッセージ（ふつうは1通）
 */
function buildAvailabilityCard_(card) {
  const size = function (x) { return JSON.stringify(x).length; };
  const fits = function (bubbles) { return bubbles.every(function (b) { return size(b) <= AVAILABILITY_BUBBLE_MAX_BYTES; }); };
  const days = card.days.days;
  const split = function (per) {
    const parts = [];
    for (let i = 0; i < days.length; i += per) parts.push(days.slice(i, i + per));
    return parts;
  };

  const one = buildAvailabilityBubble_(card, days, false);
  if (size(one) <= AVAILABILITY_BUBBLE_MAX_BYTES) return [availabilityFlex_(card, one)];

  // 大きすぎるときは、何枚かに分けて横にめくれるようにする（7日ずつ → 5日ずつ → 4日ずつ）。
  // それでも入らないときは、マスの角の丸みをやめて小さくする
  for (const square of [false, true]) {
    for (const per of [7, 5, 4]) {
      const parts = split(per);
      const bubbles = parts.map(function (part, i) {
        return buildAvailabilityBubble_(card, part, false, `${i + 1}/${parts.length}`, square);
      });
      const carousel = { type: 'carousel', contents: bubbles };
      if (fits(bubbles) && size(carousel) <= AVAILABILITY_CAROUSEL_MAX_BYTES) return [availabilityFlex_(card, carousel)];
    }
  }

  // 束にしても入らないときは、カードを何通かに分けて送る（1回の返事は5通まで）。ボタンは最後の1通だけ
  for (const per of [7, 5, 4, 3]) {
    const parts = split(per);
    if (parts.length > (card.maxMessages || 5)) break;
    const bubbles = parts.map(function (part, i) {
      return buildAvailabilityBubble_(card, part, false, `${i + 1}/${parts.length}`, true, i < parts.length - 1);
    });
    if (fits(bubbles)) return bubbles.map(function (b) { return availabilityFlex_(card, b); });
  }

  // それでも大きいときは、同じ色が続くマスを1本につなげる
  const joined = buildAvailabilityBubble_(card, days, true, '', true);
  if (size(joined) <= AVAILABILITY_BUBBLE_MAX_BYTES) return [availabilityFlex_(card, joined)];
  // どうしても入らないときは、空きのある日の文字とリンクだけ
  return [{
    type: 'text',
    text: `${availabilityFlex_(card, null).altText}\n\nくわしくはサイトで見てください:\n${card.pageUrl}`,
  }];
}

/** カードを LINE のメッセージにする。通知の文には空きのある日を並べる */
function availabilityFlex_(card, contents) {
  const openDays = card.days.days.filter(function (day) { return day.open; }).map(function (day) { return day.label; });
  const altText = `【${card.facility.name}】${card.title}` +
    (openDays.length ? `　空きのある日: ${openDays.join(' ')}` : '　空きなし');
  return { type: 'flex', altText: altText.slice(0, 400), contents: contents };
}

/**
 * カード1枚（days の日だけ）。joinRuns が true なら、同じ色が続くマスを1本につなげる。part は「1/2」など。
 * square が true なら、マスの角を丸めない（カードを小さくするため）。noButtons が true ならボタンを付けない
 */
function buildAvailabilityBubble_(card, days, joinRuns, part, square, noButtons) {
  const dark = '#111111';
  const sub = '#666666';
  const faint = '#999999';
  // 日付の文字の色：土曜は青、日曜・祝日は赤
  const dayColor = function (day) { return day.tone === 'red' ? '#CF222E' : day.tone === 'blue' ? '#0969DA' : dark; };
  const labelWidth = '16px';
  const courtNames = card.days.courts;
  const hours = getAvailabilityHours_(card.slots, card.window);

  const swatch = function (color) {
    return { type: 'box', layout: 'vertical', width: '10px', height: '10px', cornerRadius: '2px', backgroundColor: color, contents: [] };
  };
  const legendItem = function (color, text) {
    return {
      type: 'box', layout: 'horizontal', spacing: 'xs', flex: 0, alignItems: 'center',
      contents: [swatch(color), { type: 'text', text: text, size: 'xxs', color: sub, flex: 0 }],
    };
  };

  const head = [
    { type: 'text', text: card.facility.name, weight: 'bold', size: 'md', color: dark, wrap: true },
    { type: 'text', text: `${card.title}${part ? `・${part}` : ''}（${card.asOf} 時点）`, size: 'xs', color: sub, wrap: true, margin: 'sm' },
    {
      type: 'box', layout: 'horizontal', spacing: 'md', margin: 'md',
      contents: [
        legendItem(AVAILABILITY_CELL_COLORS.open, '予約できる'),
        legendItem(AVAILABILITY_CELL_COLORS.view, '空き状況のみ・一部'),
        legendItem(AVAILABILITY_CELL_COLORS.closed, '空きなし'),
      ],
    },
  ];
  // 行の左の名前。「コート1」「コート2」なら ① ②
  const courtLabel = function (court, i) {
    const mark = AVAILABILITY_COURT_MARKS[i];
    return mark && /^コート\d+$/.test(court) ? mark : court;
  };

  // 1日3行：日付の行の下に、コートごとのマスの行（左にコートの名前）
  const label = function (text) {
    return {
      type: 'box', layout: 'vertical', width: labelWidth, flex: 0,
      contents: text ? [{ type: 'text', text: text, size: 'xs', color: sub }] : [],
    };
  };
  const gridRow = function (name, cells, margin, height) {
    const grid = { type: 'box', layout: 'horizontal', spacing: '2px', contents: cells };
    if (height) grid.height = height;
    return { type: 'box', layout: 'horizontal', spacing: 'sm', alignItems: 'center', margin: margin, contents: [label(name), grid] };
  };

  // 時刻の目もり（2時間おき）
  const scale = hours.map(function (minutes, i) {
    return i % 2 === 0
      ? { type: 'text', text: formatAvailabilityMinutes_(minutes), size: 'xxs', color: faint }
      : { type: 'box', layout: 'vertical', contents: [] };
  });
  const table = [gridRow('', scale, 'lg')];

  const roomLabel = shortAvailabilityRoomLabel_(card.days.rooms);
  const cellsFor = function (date, court, dayActivities, courtNumber) {
    const own = card.slots.filter(function (s) { return s.date === date && roomLabel(s.room) === court; });
    const states = hours.map(function (minutes) { return getAvailabilityCellState_(own, minutes, minutes + 60); });
    const runs = [];
    states.forEach(function (state) {
      const last = runs[runs.length - 1];
      if (joinRuns && last && last.state === state) last.count++;
      else runs.push({ state: state, count: 1 });
    });
    // 空いている時間がつながるところの、最初のマスに始まりの時刻、最後のマスに終わりの時刻を書く
    const isOpen = function (state) { return state === 'open' || state === 'view'; };
    let index = 0;
    return runs.map(function (run) {
      const first = index;
      const last = index + run.count - 1;
      index += run.count;
      const cell = { type: 'box', layout: 'vertical', backgroundColor: AVAILABILITY_CELL_COLORS[run.state], contents: [] };
      if (!square) cell.cornerRadius = '2px';
      if (run.count > 1) cell.flex = run.count;
      // 活動の時間のマスに ⚽。どのコートかわかる予定（courts）はそのコートに、わからない予定は空きなしのマスに
      const playing = !joinRuns && (dayActivities || []).some(function (a) {
        if (!(a.start < hours[first] + 60 && a.end > hours[first])) return false;
        return a.courts && a.courts.length ? a.courts.indexOf(courtNumber) >= 0 : run.state === 'closed';
      });
      if (playing) {
        cell.justifyContent = 'center';
        cell.contents.push({ type: 'text', text: '⚽', size: 'xxs', align: 'center' });
      } else if (!joinRuns && isOpen(run.state)) {
        const starts = first === 0 || !isOpen(states[first - 1]);
        const ends = last === states.length - 1 || !isOpen(states[last + 1]);
        const label = starts ? hours[first] : ends ? hours[last] + 60 : null;
        if (label !== null) {
          cell.justifyContent = 'center';
          cell.contents.push({
            type: 'text', text: formatAvailabilityMinutes_(label), size: 'xxs', align: 'center',
            color: run.state === 'open' ? '#FFFFFF' : '#1F6B3A',
          });
        }
      }
      return cell;
    });
  };

  const activities = card.days.activities || [];
  const activitiesOn = function (date) { return activities.filter(function (a) { return a.date === date; }); };
  const activeDates = activities.map(function (a) { return a.date; });

  groupClosedAvailabilityDays_(days, activeDates).forEach(function (day) {
    if (!day.open && !day.active) {
      const range = day.lastLabel ? `${day.label}〜${day.lastLabel}` : day.label;
      table.push({ type: 'text', text: `${range}　${day.reason}`, size: 'xs', color: faint, wrap: true, margin: 'md' });
      return;
    }
    const dayActivities = activitiesOn(day.date);
    if (dayActivities.length) {
      // 日付の行に「⚽ 15-17時」を添える
      table.push({
        type: 'box', layout: 'baseline', spacing: 'sm', margin: 'md',
        contents: [
          { type: 'text', text: day.label, size: 'xs', color: dayColor(day), weight: 'bold', flex: 0 },
          { type: 'text', text: `⚽ ${dayActivities.map(formatAvailabilityActivity_).join(', ')}`, size: 'xxs', color: sub, flex: 0 },
        ],
      });
    } else {
      table.push({ type: 'text', text: day.label, size: 'xs', color: dayColor(day), weight: 'bold', margin: 'md' });
    }
    courtNames.forEach(function (court, i) {
      table.push(gridRow(courtLabel(court, i), cellsFor(day.date, court, dayActivities, i + 1), 'xs', '14px'));
    });
  });
  if (days.length === 0) {
    table.push({ type: 'text', text: 'この条件の日はありません', size: 'sm', color: faint, wrap: true, margin: 'lg' });
  }

  const bubble = {
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
      }].concat(card.nextText ? [{
        type: 'button',
        style: 'link',
        height: 'sm',
        action: { type: 'message', label: '次の2週間', text: card.nextText },
      }] : []),
    },
  };
  if (noButtons) delete bubble.footer;
  return bubble;
}
