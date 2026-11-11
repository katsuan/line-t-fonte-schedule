// ==========[ 施設の空き状況：「#灘崎」に、草グラフのような表のカードで返す ]==========

/**
 * ============================================================================
 * Availability Service（施設の空き状況）
 * ----------------------------------------------------------------------------
 * 岡山市施設予約サービスの空き状況ページが裏で使っている API（GetDay）から取って、LINE のカードで返す。
 * - 「#灘崎」… 2週間。「19-21」で時間帯、「土日」「土日祝」で曜日、「2-4w」で2週後からの2週間（今日から何週目〜何週目。組み合わせられる）
 * - 「#灘崎 1w」… 1週後からの1週間（0w 今週・1w 来週・2w 再来週…）。「#灘崎 全部 19-21」… 0w〜11w の1週間ずつのカードを横に並べる（入るぶんだけ。サイトは90日ぶんを1回だけ読む）
 * - 「#灘崎 これから 19-21」… 90日先までで空きのある日だけ（ひしょっとは毎日 OURA のうしろに足す: handleAvailabilityDigest）
 * - 「#灘崎 見張り 12/11 12/17」… 見張る日。その日に空きがあれば、これからの空きのカードを目立つ色にする（Script Properties）
 * - 取れないときは「つながらない」「作りが変わった」を分けて返す（エラーの中身は LINE に出さない）
 *
 * このファイルだけで動く（ほかのファイルからは Log だけを使う）。
 * ボットに listAvailabilityActivities_(facility, range) があれば、その施設での活動の予定を ⚽ で出す（T-FONTE だけが置いている）。
 * 入口: isAvailabilityText(text)・handleAvailabilityText(text)・handleAvailabilityDigest(text)・buildAvailabilityApiPayload(text)（表のもと。ウィジェットとくらべる見本）
 *
 * 同じものを2か所に置いている:
 * - GAS_assistant（ひしょっと）30_domain/05_availability_service.gs … 元
 * - line-t-fonte-schedule（T-FONTE）15_availability.gs … 写し
 * 直すときは元を直して、写しにそのままコピーする（中身は同じにする。T-FONTE のテストが確かめる）。
 *
 * 並び: 設定 → 見た目の決まり → 入口 → 返事を選ぶ → 書き方を読む → サイトから取る → まとめる → カード → 見張る日の登録 → 小さな道具
 * ============================================================================
 */

// ---------- 設定（施設・サイト・決まり） ----------

/**
 * 「#灘崎」のように送ると空き状況を返す施設。
 * digestWindow は、これからの空き（毎日のカード・見張る日のカードの「いま空きを見る」）で見る時間帯。
 * placeWords は、活動の予定の場所にこの言葉が入っていればこの施設とみなす言葉（listAvailabilityActivities_ を置いたボットだけが使う）。
 * facility と room は岡山市施設予約サービスの空き状況ページの URL
 * （/FacilityAvailability/Index/<facility>?...&rc=<room>）から取る。
 */
const AVAILABILITY_FACILITIES = Object.freeze([
  { key: '灘崎', name: '灘崎町総合公園 フットサルコート', facility: '331007/0029', room: '121', placeWords: ['灘崎'], digestWindow: '19-21' },
]);

const AVAILABILITY_BASE_URL = 'https://yoyacool.e-harp.jp/okayamacity/FacilityAvailability';

const AVAILABILITY_DAYS = 14;

/** これからの空き（handleAvailabilityDigest）で見る日数。サイトは1回で90日ぶん返す（先は「受付前」のことが多い） */
const AVAILABILITY_DIGEST_DAYS = 90;

/**
 * 「2-4w」のように、今日から何週目〜何週目を見るか。幅は1〜2週（カードに入る大きさ）、
 * 終わりは12週目まで（これからの空きの90日の中。先はサイトが予約をまだ受け付けていないことが多い）
 */
const AVAILABILITY_WEEKS = { width: 2, maxWidth: 2, maxEnd: 12 };

/** 「#灘崎 全部」の言葉と、横に並べるカードの数の上限（LINE は12枚まで） */
const AVAILABILITY_ALL_WORDS = ['全部', '全期間'];
const AVAILABILITY_CAROUSEL_MAX_BUBBLES = 12;

/** サイトの返事を CacheService に分けてしまうときの1つの大きさ（字数。1つの値は 100KB までで、日本語は1字3バイトになりうる） */
const AVAILABILITY_CACHE_CHUNK = 30000;

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

/** 曜日の番号のほかに、祝日を表す番号（日=0〜土=6 のつぎ） */
const AVAILABILITY_HOLIDAY = 7;

/** 「#灘崎 見張り …」の「見張り」にあたる言葉 */
const AVAILABILITY_WATCH_WORDS = Object.freeze(['見張り', '見張る', 'みはり']);

// ---------- 見た目の決まり（色・大きさの上限・コートの印） ----------

/** マスの色（草グラフのように、濃い緑ほど使いやすい） */
const AVAILABILITY_CELL_COLORS = Object.freeze({
  open: '#2DA44E',   // ネットで予約できる
  view: '#A8DFB8',   // 空き状況のみ（ネットでは予約できない）・一部だけ空き
  closed: '#E3E5E8', // 空きなし・設備保守など
  none: '#F7F7F7',   // 受け付けている時間の外
});

/**
 * カードの文字の色：濃い（日付・見出し）・ふつう（説明）・うすい（空きなし・目もり）・土曜・日曜と祝日・
 * 濃い色の上（帯・濃い緑のマス）・うすい緑のマスの上
 */
const AVAILABILITY_TEXT_COLORS = Object.freeze({
  dark: '#111111', sub: '#666666', faint: '#999999', saturday: '#0969DA', holiday: '#CF222E',
  onDark: '#FFFFFF', onLight: '#1F6B3A',
});

/** 見張る日の欄の地の色（ふだん・目立つ色のカードの上） */
const AVAILABILITY_PANEL_COLORS = Object.freeze({ normal: '#F6F6F6', onAlert: '#FFFFFF' });

/** 見張る日に空きがあるときのカードの色（地はうすいオレンジ、上の帯は濃いオレンジ） */
const AVAILABILITY_ALERT_COLORS = Object.freeze({ background: '#FFF4E5', band: '#D9480F' });

/** LINE のカードの大きさの上限（1枚 30KB・横にめくる束で 50KB）より少し小さく */
const AVAILABILITY_BUBBLE_MAX_BYTES = 28000;

const AVAILABILITY_CAROUSEL_MAX_BYTES = 48000;

const AVAILABILITY_COURT_MARKS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

// ---------- 入口（ボットから呼ぶ） ----------

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
 * 「#灘崎 見張り」で見張る日を登録していれば、その日に空きがあるときはカードを目立つ色にし、その日に「見張る日」の印を付ける。
 * 空きがないときは何も返さない（ほかの返事のうしろに足して使うので、じゃまをしない）。
 * ただし見張る日を登録しているあいだは、見張る日の様子を見せるため、空きがなくてもカードを返す。
 * 取れなかったとき・見慣れない状態があったときは、こわれたまま気づかないことがないよう、短い文で知らせる。
 * 名前の後ろに _ を付けないのは、ライブラリの外（親のボット）から呼べるようにするため。
 *
 * @param {string} text
 * @param {Date=} now
 * @returns {Object[]} 0通か1通
 */
function handleAvailabilityDigest(text, now) {
  const request = detectAvailabilityFacility_(text);
  if (!request || request.badOption || request.watch) return [];
  const at = now || new Date();
  return respondAvailability_(asAvailabilityDigest_(request, at), at).slice(0, 1);
}

/**
 * 表のもと（カードの代わり）。ウィジェット（q-sqriptable の SQriptableField。GAS を通さずサイトから直接読む）が
 * 同じ決まりで同じ表を作れているかをくらべる見本に使う（q-sqriptable の test/fixtures/field-expected.json を、これで作った）。
 * 「#灘崎」「#灘崎 19-21 土日」「#灘崎 2-4w」「#灘崎 これから」など LINE と同じ書き方。読むだけ（見張る日の書きかえは受けない）。
 * 取れないときも投げずに status で返す（ウィジェットがやさしい言葉で出せるように）。
 * 名前の後ろに _ を付けないのは、ライブラリの外（親のボット）から呼べるようにするため。
 *
 * T-FONTE の管理ページは options.spanDays（90）で、今日から90日ぶんのマスを全部（空きのない日も）読む。
 * そのときは見張る日も添える（見張る日の印と様子）。
 * options.cacheMinutes があれば、サイトの返事をその分だけしまって使う（fresh なら読み直す）。
 * asOf はサイトから取った時刻。読めなくてしまった返事を使ったときは stale: true。
 *
 * @param {string} text
 * @param {Date=} now
 * @param {{spanDays: (number|undefined), cacheMinutes: (number|undefined), fresh: (boolean|undefined)}=} options
 * @returns {{status: string, message: (string|undefined), facility: (Object|undefined), title: (string|undefined),
 *   asOf: (string|undefined), digest: (boolean|undefined), hours: (number[]|undefined), courts: (string[]|undefined),
 *   days: (Object[]|undefined), watch: (Object[]|null|undefined), alert: (boolean|undefined),
 *   unknownStatuses: (string[]|undefined), pageUrl: (string|undefined), nextQuery: (string|undefined)}}
 *   status … ok / down（つながらない）/ changed（作りが変わった）/ bad（書き方がちがう）
 *   days[].cells … コートの名前 → 1時間ずつの状態（open・view・closed・none。hours と同じ並び）
 */
function buildAvailabilityApiPayload(text, now, options) {
  const request = detectAvailabilityFacility_(text);
  if (!request || request.badOption || request.watch) {
    return { status: 'bad', message: '「#灘崎」「#灘崎 19-21」「#灘崎 これから」のように書いてください。' };
  }
  const at = now || new Date();
  const digest = Boolean(request.digest);
  const spanDays = !digest && options && options.spanDays
    ? Math.min(Math.max(1, Math.floor(options.spanDays)), AVAILABILITY_DIGEST_DAYS)
    : 0;
  if (digest) asAvailabilityDigest_(request, at);
  else if (spanDays) asAvailabilitySpan_(request, spanDays, at);
  if (options && options.cacheMinutes) request.cache = { minutes: options.cacheMinutes, fresh: Boolean(options.fresh) };

  const facility = request.facility;
  const range = getAvailabilityRange_(at, request.fromWeek * 7, request.spanDays || request.weeks * 7);
  const pageUrl = buildAvailabilityPageUrl_(facility, range);
  const base = {
    facility: { key: facility.key, name: facility.name },
    title: `${buildAvailabilityLabel_(request, range)}空き状況`,
    asOf: Utilities.formatDate(at, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX"),
    digest: digest,
    pageUrl: pageUrl,
  };

  let view;
  try {
    view = loadAvailabilityView_(request, range, at);
  } catch (err) {
    logAvailabilityError_(err);
    const changed = err && err.availabilityKind === 'changed';
    return Object.assign(base, {
      status: changed ? 'changed' : 'down',
      message: changed ? 'サイトの作りが変わったようで、読めませんでした。' : 'サイトにつながりませんでした。',
    });
  }

  const hours = getAvailabilityHours_(view.slots, request.window);
  const roomLabel = shortAvailabilityRoomLabel_(view.days.rooms);
  const watchDates = request.watchDates || [];
  const activities = view.days.activities || [];
  const days = view.days.days
    .filter(function (day) { return !request.onlyOpen || day.open; })
    .map(function (day) {
      const cells = {};
      view.days.courts.forEach(function (court) {
        const own = view.slots.filter(function (s) { return s.date === day.date && roomLabel(s.room) === court; });
        cells[court] = hours.map(function (minutes) { return getAvailabilityCellState_(own, minutes, minutes + 60); });
      });
      return {
        date: day.date,
        label: day.label,
        tone: day.tone,
        open: day.open,
        reason: day.reason,
        watched: watchDates.indexOf(day.date) >= 0,
        activities: activities.filter(function (a) { return a.date === day.date; })
          .map(function (a) { return { start: a.start, end: a.end, courts: a.courts || [] }; }),
        cells: cells,
      };
    });

  if (view.fetchedAt) base.asOf = Utilities.formatDate(new Date(view.fetchedAt), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX");
  if (view.stale) base.stale = true;
  return Object.assign(base, {
    status: 'ok',
    hours: hours,
    courts: view.days.courts,
    days: days,
    watch: view.watchStatus,
    alert: days.some(function (day) { return day.open && day.watched; }),
    unknownStatuses: view.unknownStatuses,
    nextQuery: digest || spanDays ? '' : buildAvailabilityNextText_(request),
  });
}

// ---------- 返事を選ぶ ----------

/**
 * 「#灘崎 …」への返事を選ぶ：見張る日の登録・書き方の例・これからの空き・ふつうの空き状況
 *
 * @param {Object} request detectAvailabilityFacility_ の戻り値
 * @param {Date=} now
 * @returns {Object[]}
 */
function handleAvailabilityCommand_(request, now) {
  const at = now || new Date();
  if (request.watch) return handleAvailabilityWatch_(request, at);
  if (request.badOption) return [buildAvailabilityHelpMessage_(request.facility)];
  if (request.all) return respondAvailabilityAll_(request, at);
  if (request.digest) {
    const messages = respondAvailability_(asAvailabilityDigest_(request, at), at).slice(0, 1);
    if (messages.length) return messages;
    // 送ってきた人には、空きがないことも返す（毎日のカードでは何も足さない）
    return [{
      type: 'text',
      text: `【${request.facility.name}】これから${AVAILABILITY_DIGEST_DAYS}日の${formatAvailabilityWindow_(request.window)}に、空きのある日はありません。`,
    }];
  }
  return respondAvailability_(request, at);
}

/**
 * これからの空きの決まり：今日から AVAILABILITY_DIGEST_DAYS 日・空きのある日だけ・1通・見張る日を目立たせる。
 * 時間帯がなければ施設の digestWindow（灘崎は 19-21）
 */
function asAvailabilityDigest_(request, now) {
  request.spanDays = AVAILABILITY_DIGEST_DAYS;
  request.fromWeek = 0;
  request.onlyOpen = true;
  request.maxMessages = 1;
  if (!request.window && request.facility.digestWindow) request.window = parseAvailabilityWindow_(request.facility.digestWindow);
  // 見張る日が登録されていれば、その日に空きがあるときにカードを目立たせる（ほかの日も出す）
  const watched = pruneAvailabilityWatchDates_(request.facility, now);
  if (watched.length) request.watchDates = watched;
  return request;
}

/** 今日から spanDays 日の空き状況（空きのない日も出す）。見張る日があれば印と様子を添える */
function asAvailabilitySpan_(request, spanDays, now) {
  request.spanDays = spanDays;
  request.fromWeek = 0;
  const watched = pruneAvailabilityWatchDates_(request.facility, now);
  if (watched.length) request.watchDates = watched;
  return request;
}

/**
 * 空き状況を取ってカードにする。時間帯・曜日があれば、そこだけにしぼる。
 *
 * @param {{facility: Object, window: ({start: number, end: number}|null), days: (number[]|null), fromWeek: number, weeks: number,
 *   spanDays: (number|undefined), onlyOpen: (boolean|undefined), maxMessages: (number|undefined), watchDates: (string[]|undefined)}} request
 *   spanDays … 何日ぶん見るか（ふだんは2週間）/ onlyOpen … 空きのある日だけ（なければ []）/ maxMessages … 何通までに分けてよいか
 *   watchDates … 見張る日（空きがあればカードを目立たせる）
 * @param {Date} at
 * @returns {Object[]}
 */
function respondAvailability_(request, at) {
  const facility = request.facility;
  const range = getAvailabilityRange_(at, request.fromWeek * 7, request.spanDays || request.weeks * 7);
  const pageUrl = buildAvailabilityPageUrl_(facility, range);
  const title = `${buildAvailabilityLabel_(request, range)}空き状況`;

  let view;
  try {
    view = loadAvailabilityView_(request, range, at);
  } catch (err) {
    // 中身はログにだけ残し、LINE にはやさしい言葉とリンクだけを返す
    logAvailabilityError_(err);
    return [buildAvailabilityErrorMessage_(facility, title, pageUrl, err)];
  }

  const days = view.days;
  if (request.onlyOpen) {
    days.days = days.days.filter(function (day) { return day.open; });
    // 空きのある日がなくても、見張る日があればその様子を返す
    if (days.days.length === 0 && !(view.watchStatus && view.watchStatus.length)) {
      if (!view.unknownStatuses.length) return [];
      // 知らない状態があるときは、それが空きかもしれないので知らせる
      return [{
        type: 'text',
        text: `【${facility.name}】${title}に、見慣れない状態（${view.unknownStatuses.join('・')}）がありました。\nサイトの作りが変わったかもしれないので、サイトで見てください:\n${pageUrl}`,
      }];
    }
  }

  return buildAvailabilityCard_(availabilityCardOf_(request, range, view, at));
}

/** カードのもと（buildAvailabilityCard_・buildAvailabilityBubble_ に渡す形） */
function availabilityCardOf_(request, range, view, at) {
  const watchDates = request.watchDates || [];
  return {
    facility: request.facility,
    fromWeek: request.fromWeek,
    title: `${buildAvailabilityLabel_(request, range)}空き状況`,
    asOf: Utilities.formatDate(at, 'Asia/Tokyo', 'M/d HH:mm'),
    window: request.window,
    nextText: request.spanDays ? '' : buildAvailabilityNextText_(request),
    nextLabel: request.weeks === 1 ? '次の週' : `次の${request.weeks}週間`,
    weekTag: request.spanDays ? '' : formatAvailabilityWeekTag_(request.fromWeek, request.weeks),
    maxMessages: request.maxMessages || 5,
    watchDates: watchDates,
    unknownStatuses: view.unknownStatuses,
    watchStatus: view.watchStatus,
    // 見張る日に空きがあるときは、カードを目立つ色にする
    alert: view.days.days.some(function (day) { return day.open && watchDates.indexOf(day.date) >= 0; }),
    slots: view.slots,
    days: view.days,
    pageUrl: buildAvailabilityPageUrl_(request.facility, range),
  };
}

/**
 * 「#灘崎 全部」：今日から AVAILABILITY_WEEKS.maxEnd 週目まで、1週間ずつのカード（上に「0w（今週）」）を横に並べて1通で返す。
 * サイトは AVAILABILITY_DIGEST_DAYS 日ぶんを1回だけ読んで、そこから切り出す。
 * LINE の大きさの上限に入るぶんだけ並べ、入らなかった先は、最後のカードの「次の2週間」ボタンで見る。
 * 1枚目から入らない（時間帯をしぼっていないなど）ときは、ふつうの「#灘崎」と同じ返事にする
 *
 * @returns {Object[]}
 */
function respondAvailabilityAll_(given, at) {
  const request = Object.assign({}, given, { weeks: 1 });
  const facility = request.facility;
  const whole = getAvailabilityRange_(at, 0, AVAILABILITY_DIGEST_DAYS);
  // spanDays を入れると、見出しに期間の日付が付く
  const wholeTitle = `${buildAvailabilityLabel_(Object.assign({}, request, { spanDays: 1 }), getAvailabilityRange_(at, 0, AVAILABILITY_WEEKS.maxEnd * 7))}空き状況`;
  let data;
  try {
    data = fetchAvailability_(facility, whole);
  } catch (err) {
    logAvailabilityError_(err);
    return [buildAvailabilityErrorMessage_(facility, wholeTitle, buildAvailabilityPageUrl_(facility, whole), err)];
  }

  const size = function (x) { return JSON.stringify(x).length; };
  const cards = [];
  const bubbles = [];
  for (let from = 0; from + request.weeks <= AVAILABILITY_WEEKS.maxEnd && bubbles.length < AVAILABILITY_CAROUSEL_MAX_BUBBLES; from += request.weeks) {
    const part = Object.assign({}, request, { fromWeek: from, all: false, showDates: true });
    const range = getAvailabilityRange_(at, from * 7, request.weeks * 7);
    let view;
    try {
      view = loadAvailabilityView_(part, range, at, data);
    } catch (err) {
      logAvailabilityError_(err);
      return [buildAvailabilityErrorMessage_(facility, wholeTitle, buildAvailabilityPageUrl_(facility, whole), err)];
    }
    const card = availabilityCardOf_(part, range, view, at);
    card.nextText = ''; // 続きのボタンは、最後のカードにだけ付ける（下）
    const bubble = buildAvailabilityBubble_(card, card.days.days, false);
    // 先の日がサイトにまだない（返事が短い）ときと、大きすぎるときは、そこで止める
    if (!card.days.days.length && !card.slots.length) break;
    if (size(bubble) > AVAILABILITY_BUBBLE_MAX_BYTES) break;
    if (size({ type: 'carousel', contents: bubbles.concat(bubble) }) > AVAILABILITY_CAROUSEL_MAX_BYTES) break;
    cards.push(card);
    bubbles.push(bubble);
  }
  if (!bubbles.length) return respondAvailability_(Object.assign({}, request, { all: false, fromWeek: 0 }), at);

  // 入りきらなかった先があれば、最後のカードに「次の2週間」ボタン（ボタンの文の分だけ大きくなるので、入らなければ付けない）
  const last = cards[cards.length - 1];
  last.nextText = buildAvailabilityNextText_(Object.assign({}, request, { fromWeek: last.fromWeek }));
  if (last.nextText) {
    const withNext = buildAvailabilityBubble_(last, last.days.days, false);
    const trial = bubbles.slice(0, -1).concat(withNext);
    if (size(withNext) <= AVAILABILITY_BUBBLE_MAX_BYTES && size({ type: 'carousel', contents: trial }) <= AVAILABILITY_CAROUSEL_MAX_BYTES) bubbles[bubbles.length - 1] = withNext;
  }

  // 通知の文には、並べたぶんの空きのある日（見出しは全体の期間）
  const shownEnd = getAvailabilityRange_(at, last.fromWeek * 7, request.weeks * 7).end;
  const summary = Object.assign({}, cards[0], {
    title: `${buildAvailabilityLabel_(Object.assign({}, request, { spanDays: 1 }), { start: whole.start, end: shownEnd })}空き状況`,
    alert: false,
    days: Object.assign({}, cards[0].days, { days: [].concat.apply([], cards.map(function (c) { return c.days.days; })) }),
  });
  return [availabilityFlex_(summary, bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles })];
}

/** 読めない書き方への返事：書き方の例 */
function buildAvailabilityHelpMessage_(facility) {
  return {
    type: 'text',
    text: [
      '書き方の例:',
      `#${facility.key} … 2週間の空き`,
      `#${facility.key} 19-21 … 19〜21時の空き`,
      `#${facility.key} 土日 … 土日の空き（土日祝・平日・月水金 なども）`,
      `#${facility.key} 土日 19-21 … 両方でしぼる`,
      `#${facility.key} 2-4w … 2週後からの2週間（今日から何週目〜何週目。1-3w・4-6w など）`,
      `#${facility.key} 1w … 来週（0w 今週・2w 再来週…。今日から7日ずつ）`,
      `#${facility.key} 全部 19-21 … 0w〜11w の1週間ずつを横に並べる（入るぶんだけ）`,
      `#${facility.key} これから 19-21 … ${AVAILABILITY_DIGEST_DAYS}日先までの空きのある日`,
      `#${facility.key} 見張り … 見張る日（見る・入れかえ・足す・消す）`,
    ].join('\n'),
  };
}

/** 取れなかったときの返事。つながらないのか、作りが変わったのかを分ける（エラーの中身は出さない） */
function buildAvailabilityErrorMessage_(facility, title, pageUrl, err) {
  const why = err && err.availabilityKind === 'changed'
    ? 'サイトの作りが変わったようで、読めませんでした。直すまでのあいだはサイトで見てください:'
    : 'サイトにつながりませんでした。少しあとでもう一度ためすか、サイトで見てください:';
  return { type: 'text', text: `【${facility.name}】${title}を取れませんでした。\n${why}\n${pageUrl}` };
}

/** 「11/22〜12/5 土日 19-21時の」「土曜の」「」（日付は、今日から2週間でないときだけ） */
function buildAvailabilityLabel_(request, range) {
  const labels = [];
  if ((request.fromWeek || request.weeks !== AVAILABILITY_WEEKS.width || request.spanDays || request.showDates) && range) {
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
 * 「次の2週間」ボタンで送る文（「2-4w」のあとなら「4-6w」。いまの曜日・時間帯はそのまま）。これ以上先は出さないなら ''。
 * 押されるたびにその時の空きを取るので、あとで押されても困らない。
 */
function buildAvailabilityNextText_(request) {
  const from = request.fromWeek + request.weeks;
  if (from + request.weeks > AVAILABILITY_WEEKS.maxEnd) return '';
  const parts = [`#${request.facility.key}`, formatAvailabilityWeeks_(from, from + request.weeks)];
  if (request.days) parts.push(formatAvailabilityDays_(request.days));
  if (request.window) parts.push(formatAvailabilityWindow_(request.window));
  return parts.join(' ');
}

// ---------- 書き方を読む ----------

/**
 * 「#灘崎」「＃ 灘崎」「#灘崎 19-21」「#灘崎 土日」「#灘崎 2-4w」「#灘崎 2-4w 土日 19-21」から施設・時間帯・曜日・何週目〜何週目かを取り出す。
 * 「#灘崎 見張り …」なら watch（見張る日の登録。tokens は「見張り」のあとの言葉）を付けて返す。
 * 「#灘崎 これから 19-21」なら digest（これからの空き。毎日のカードと同じもの）を付ける。
 * 当てはまらなければ null。施設のあとが読めないときは badOption を true にする（書き方を返すため）。
 *
 * @param {string} text
 * @returns {{facility: Object, window: ({start: number, end: number}|null), days: (number[]|null), fromWeek: number, weeks: number, badOption: boolean}|null}
 */
function detectAvailabilityFacility_(text) {
  const match = String(text || '').trim().match(/^[#＃]\s*(\S+)(?:[\s　]+(.+))?$/u);
  if (!match) return null;
  const facility = AVAILABILITY_FACILITIES.find(function (f) { return f.key === match[1]; });
  if (!facility) return null;

  const request = { facility: facility, window: null, days: null, fromWeek: 0, weeks: AVAILABILITY_WEEKS.width, badOption: false };
  const tokens = String(match[2] || '').split(/[\s　、,]+/).filter(Boolean);
  // 「#灘崎 見張り …」は見張る日の登録（日付の読み取りは今日がわかってから）
  if (tokens.length && AVAILABILITY_WATCH_WORDS.indexOf(tokens[0]) >= 0) {
    request.watch = { tokens: tokens.slice(1) };
    return request;
  }
  tokens.forEach(function (token) {
    if (token === 'これから' && !request.digest) { request.digest = true; return; }
    if (AVAILABILITY_ALL_WORDS.indexOf(token) >= 0 && !request.all) { request.all = true; return; }
    const weeks = parseAvailabilityWeeks_(token);
    const days = weeks ? null : parseAvailabilityDays_(token);
    const window = weeks || days ? null : parseAvailabilityWindow_(token);
    if (weeks && !request.weeksSet) Object.assign(request, { fromWeek: weeks.from, weeks: weeks.to - weeks.from, weeksSet: true });
    else if (days && !request.days) request.days = days;
    else if (window && !request.window) request.window = window;
    else request.badOption = true;
  });
  // 「全部」は「これから」「2-4w」とはいっしょにしない（どの期間かがぶつかる）
  if (request.all && (request.digest || request.weeksSet)) request.badOption = true;
  return request;
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
  return uniqueAvailabilityValues_(t.split('').map(function (c) {
    return c === '祝' ? AVAILABILITY_HOLIDAY : AVAILABILITY_WEEKDAYS.indexOf(c);
  }));
}

/**
 * 今日から何週目〜何週目か（週は今日から7日ずつ）。
 * 「2-4w」「２〜４週」→ {from: 2, to: 4}、「1w」「1週目」→ {from: 1, to: 2}（その週の1週間）、「2週間」→ {from: 0, to: 2}。
 * 幅が AVAILABILITY_WEEKS の外（「0-4w」「10-14w」など）や読めなければ null。
 *
 * @param {string} text
 * @returns {{from: number, to: number}|null}
 */
function parseAvailabilityWeeks_(text) {
  const t = String(text || '')
    .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .toLowerCase()
    .replace(/[〜～ー－−–—]/g, '-');
  const one = t.match(/^(\d{1,2})(?:w|週目)$/);
  const span = t.match(/^(\d{1,2})週間$/);
  const m = one ? [null, one[1], String(Number(one[1]) + 1)] : span ? [null, '0', span[1]] : t.match(/^(\d{1,2})-(\d{1,2})(?:w|週間?)$/);
  if (!m) return null;
  const from = Number(m[1]);
  const to = Number(m[2]);
  const width = to - from;
  return width >= 1 && width <= AVAILABILITY_WEEKS.maxWidth && to <= AVAILABILITY_WEEKS.maxEnd ? { from: from, to: to } : null;
}

/**
 * 「11/5」「11月5日」「2026/11/5」「１２/１１」を 'yyyy-MM-dd' にする。読めなければ ''。
 * 年がなければ今年。今日から60日より前になるときは来年（1月に「12/11」と書けば去年ではなく、11月に「1/13」と書けば来年）。
 *
 * @param {string} text
 * @param {Date} now
 * @returns {string}
 */
function parseAvailabilityDate_(text, now) {
  const t = String(text || '').replace(/[０-９／]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
  let m = t.match(/^(\d{4})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})日?$/);
  let year;
  let month;
  let day;
  if (m) {
    year = Number(m[1]); month = Number(m[2]); day = Number(m[3]);
  } else {
    m = t.match(/^(\d{1,2})[\/月.](\d{1,2})日?$/);
    if (!m) return '';
    month = Number(m[1]); day = Number(m[2]);
    const today = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
    year = Number(today.slice(0, 4));
    const ymd = function (y) { return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`; };
    const limit = Utilities.formatDate(new Date(now.getTime() - 60 * 86400000), 'Asia/Tokyo', 'yyyy-MM-dd');
    if (ymd(year) < limit) year += 1;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** その日が、しぼった曜日に入るか（しぼっていなければいつも true）。「祝」をしぼったときは、祝日も入る */
function isAvailabilityDay_(date, days, holidays) {
  if (!days) return true;
  if (days.indexOf(new Date(`${date}T00:00:00Z`).getUTCDay()) >= 0) return true;
  return days.indexOf(AVAILABILITY_HOLIDAY) >= 0 && Boolean(holidays && holidays[date]);
}

// ---------- サイトから取る ----------

/**
 * 日本時間の今日から fromDay 日あとからの spanDays 日（ふつうは今日から2週間。「2-4w」なら15日目から2週間）。
 *
 * @param {Date} now
 * @param {number=} fromDay
 * @param {number=} spanDays
 * @returns {{start: string, end: string, days: number}}
 */
function getAvailabilityRange_(now, fromDay, spanDays) {
  const span = spanDays || AVAILABILITY_DAYS;
  const first = fromDay || 0;
  const day = function (offset) {
    return Utilities.formatDate(new Date(now.getTime() + (first + offset) * 86400000), 'Asia/Tokyo', 'yyyy-MM-dd');
  };
  return { start: day(0), end: day(span - 1), days: span };
}

/**
 * サイトの返事を、しまってあれば使う（cache.minutes 分まで。cache.fresh なら読み直す）。
 * 読めなければ、しまってあった返事を stale として返す（なければ投げる）。
 * 90日ぶんの返事は 100KB をこえるので、いくつかに分けて CacheService にしまう
 *
 * @returns {{data: Object, fetchedAt: number, stale: (boolean|undefined)}}
 */
function readAvailabilitySiteCached_(facility, range, cache, at) {
  const store = CacheService.getScriptCache();
  const key = `availability-site-${facility.room}-${range.start}-${range.days}`;
  const read = function () {
    try {
      const head = JSON.parse(store.get(key) || 'null');
      if (!head) return null;
      const keys = [];
      for (let i = 0; i < head.parts; i++) keys.push(`${key}-${i}`);
      const parts = store.getAll(keys);
      if (keys.some(function (k) { return typeof parts[k] !== 'string'; })) return null;
      return { fetchedAt: head.fetchedAt, data: JSON.parse(keys.map(function (k) { return parts[k]; }).join('')) };
    } catch (err) {
      return null;
    }
  };
  const cached = read();
  if (cached && !cache.fresh && at.getTime() - cached.fetchedAt < cache.minutes * 60000) return cached;
  let data;
  try {
    data = fetchAvailability_(facility, range);
  } catch (err) {
    if (cached) return Object.assign(cached, { stale: true });
    throw err;
  }
  const text = JSON.stringify(data);
  const values = {};
  let parts = 0;
  for (let i = 0; i < text.length; i += AVAILABILITY_CACHE_CHUNK) values[`${key}-${parts++}`] = text.slice(i, i + AVAILABILITY_CACHE_CHUNK);
  values[key] = JSON.stringify({ fetchedAt: at.getTime(), parts: parts });
  try {
    store.putAll(values, Math.min(21600, Math.max(60, Math.ceil(cache.minutes * 60 * 2))));
  } catch (err) {
    logAvailabilityError_(err);
  }
  return { fetchedAt: at.getTime(), data: data };
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
    throw availabilityError_('down', `サイトの応答 ${statusCode}`);
  }
  let data;
  try {
    data = JSON.parse(response.getContentText() || '{}');
  } catch (err) {
    throw availabilityError_('changed', '応答が JSON ではありません');
  }
  if (!data || !Array.isArray(data.rooms)) {
    throw availabilityError_('changed', '応答に rooms がありません');
  }
  return data;
}

/**
 * 取れなかったわけ（kind）を付けたエラー。down … サイトにつながらない / changed … サイトの作りが変わった
 *
 * @param {string} kind
 * @param {string} message ログにだけ残す
 * @returns {Error}
 */
function availabilityError_(kind, message) {
  const err = new Error(message);
  err.availabilityKind = kind;
  return err;
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
 * 知らない状態のコードの枠には unknown を付ける（空きなしとして色を付け、カードでお知らせする）
 * @returns {Array<{room: string, date: string, start: string, end: string, status: string, unknown: boolean}>}
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
            unknown: !AVAILABILITY_STATUS_LABELS[u.statusType],
          });
        });
      });
    });
  });
  return slots;
}

/**
 * サイトから取って（given があれば、読んである返事を使って）、カードに使う形にまとめる。取れない・作りが変わったときは availabilityError_ を投げる
 *
 * @returns {{slots: Object[], days: Object, unknownStatuses: string[], watchStatus: (Object[]|null)}}
 */
function loadAvailabilityView_(request, range, at, given) {
  const site = !given && request.cache ? readAvailabilitySiteCached_(request.facility, range, request.cache, at) : null;
  const data = given || (site ? site.data : fetchAvailability_(request.facility, range));
  const holidays = toAvailabilityHolidays_(data);
  const readSlots = toAvailabilitySlots_(data);
  // 応答の形はそれらしくても、枠が1つも読めなければ、サイトの作りが変わったとみなす
  if (readSlots.length === 0) throw availabilityError_('changed', '枠が1つも読めません');
  // 長い期間の返事（「全部」の90日）から切り出すときもあるので、見る期間の枠だけにする
  const allSlots = readSlots.filter(function (slot) { return slot.date >= range.start && slot.date <= range.end; });

  const unknownStatuses = uniqueAvailabilityValues_(allSlots
    .filter(function (slot) { return slot.unknown; })
    .map(function (slot) { return slot.status; }));
  if (unknownStatuses.length) logAvailabilityError_(new Error(`知らない状態のコード: ${unknownStatuses.join(',')}`));

  const inDays = function (date) { return isAvailabilityDay_(date, request.days, holidays); };
  const slots = allSlots.filter(function (slot) { return inDays(slot.date); });
  const days = collectAvailabilityDays_(slots, request.window, holidays);
  days.activities = readAvailabilityActivities_(request.facility, range).filter(function (a) { return inDays(a.date); });

  return {
    fetchedAt: site ? site.fetchedAt : 0,
    stale: Boolean(site && site.stale),
    slots: slots,
    days: days,
    unknownStatuses: unknownStatuses,
    watchStatus: request.watchDates && request.watchDates.length
      ? buildAvailabilityWatchStatus_(request.watchDates, days.days, allSlots, at)
      : null,
  };
}

// ---------- まとめる（日ごと・マス・活動・見張る日の様子） ----------

/**
 * 日ごとにまとめる：その日に（時間帯があればその中に）空きがあるか・空きなしのわけ・日付の名前と色。
 * マスの色は、カードを作るときに枠（slots）から決める（getAvailabilityCellState_）。
 *
 * @param {Object[]} slots toAvailabilitySlots_ の戻り値
 * @param {{start: number, end: number}|null} window
 * @param {Object<string, string>=} holidays toAvailabilityHolidays_ の戻り値
 * @returns {{courts: string[], rooms: string[], days: Array<{date: string, label: string, tone: string, open: boolean, reason: string}>}}
 *   rooms はサイトの部屋の名前、courts はカードに出す短い名前（「コート1」）
 */
function collectAvailabilityDays_(slots, window, holidays) {
  const from = window ? window.start : 0;
  const to = window ? window.end : 24 * 60;
  const byDate = {};
  const rooms = [];
  slots.forEach(function (s) {
    if (rooms.indexOf(s.room) < 0) rooms.push(s.room);
    // 時間帯の外の枠は見ない
    if (Math.max(toAvailabilityMinutes_(s.start), from) >= Math.min(toAvailabilityMinutes_(s.end), to)) return;
    (byDate[s.date] = byDate[s.date] || []).push(s.status);
  });
  rooms.sort();

  const days = Object.keys(byDate).sort().map(function (date) {
    const statuses = byDate[date];
    const reasons = uniqueAvailabilityValues_(statuses.filter(function (x) {
      return x !== '空きなし' && !AVAILABILITY_OPEN_STATUSES.includes(x);
    }));
    return {
      date: date,
      label: formatAvailabilityDate_(date, holidays),
      tone: availabilityDayTone_(date, holidays),
      open: statuses.some(function (x) { return AVAILABILITY_OPEN_STATUSES.includes(x); }),
      reason: reasons.length ? `空きなし（${reasons.join('・')}）` : '空きなし',
    };
  });
  return { courts: rooms.map(shortAvailabilityRoomLabel_(rooms)), rooms: rooms, days: days };
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

/**
 * カードの下に足すリンクのボタン（置いたボットだけ。T-FONTE は管理ページの空きの表）。
 * availabilityExtraLinks_(facility) が [{label, uri}] を返せば、そのボタンを足す
 */
function readAvailabilityExtraButtons_(facility) {
  if (typeof availabilityExtraLinks_ !== 'function') return [];
  try {
    return (availabilityExtraLinks_(facility) || [])
      .filter(function (link) { return link && link.label && /^https:\/\//.test(link.uri || ''); })
      .map(function (link) { return { type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: link.label, uri: link.uri } }; });
  } catch (err) {
    logAvailabilityError_(err);
    return [];
  }
}

/**
 * 見張る日（今日から先）の今の様子。毎日のカードの上の「見張る日」の欄に出す
 *
 * @returns {Array<{date: string, label: string, tone: string, open: boolean, text: string}>}
 */
function buildAvailabilityWatchStatus_(watchDates, days, allSlots, at) {
  const today = Utilities.formatDate(at, 'Asia/Tokyo', 'yyyy-MM-dd');
  const known = allSlots.map(function (slot) { return slot.date; });
  return watchDates.filter(function (date) { return date >= today; }).map(function (date) {
    const day = days.find(function (d) { return d.date === date; });
    let text = 'まだ見られません（サイトにまだない先の日）';
    if (day) text = day.open ? '空きあり' : day.reason;
    else if (known.indexOf(date) >= 0) text = 'この時間の枠がありません';
    return {
      date: date,
      label: day ? day.label : formatAvailabilityDate_(date),
      tone: day ? day.tone : availabilityDayTone_(date),
      open: Boolean(day && day.open),
      text: text,
    };
  });
}

// ---------- カード ----------

/**
 * 空き状況のカード。草グラフのように、横に1時間ずつのマス。1日3行（日付・①・②）。日付の文字は、土曜は青、日曜・祝日は赤。
 * 空いている時間がつながるところは、最初のマスに始まり、最後のマスに終わりの時刻を書く。
 * 見張る日を登録しているときは、上に「見張る日」の欄（今日から先の見張る日の様子）をいつも出す。
 * 見張る日に空きがあるとき（card.alert）は、地をうすいオレンジにして、上に「見張る日に空きがあります（12/11(金)）」の帯。見張る日の日付には「見張る日」の印。
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
  const altText = `${card.alert ? '【見張る日に空き】' : ''}【${card.facility.name}】${card.title}` +
    (openDays.length ? `　空きのある日: ${openDays.join(' ')}` : '　空きなし');
  return { type: 'flex', altText: altText.slice(0, 400), contents: contents };
}

/**
 * カード1枚（days の日だけ）。joinRuns が true なら、同じ色が続くマスを1本につなげる。part は「1/2」など。
 * square が true なら、マスの角を丸めない（カードを小さくするため）。noButtons が true ならボタンを付けない
 */
function buildAvailabilityBubble_(card, days, joinRuns, part, square, noButtons) {
  const dark = AVAILABILITY_TEXT_COLORS.dark;
  const sub = AVAILABILITY_TEXT_COLORS.sub;
  const faint = AVAILABILITY_TEXT_COLORS.faint;
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

  // 日付の文字の色：土曜は青、日曜・祝日は赤
  const dayColor = function (day) {
    return day.tone === 'red' ? AVAILABILITY_TEXT_COLORS.holiday : day.tone === 'blue' ? AVAILABILITY_TEXT_COLORS.saturday : dark;
  };
  const head = [];
  if (card.alert) {
    head.push({
      type: 'box', layout: 'vertical', backgroundColor: AVAILABILITY_ALERT_COLORS.band, cornerRadius: '4px',
      paddingAll: '8px', margin: 'none',
      contents: [{
        type: 'text', weight: 'bold', size: 'sm', color: AVAILABILITY_TEXT_COLORS.onDark, wrap: true,
        text: `見張る日に空きがあります（${days.filter(function (day) { return day.open && card.watchDates.indexOf(day.date) >= 0; })
          .map(function (day) { return day.label; }).join(' ')}）`,
      }],
    });
  }
  // いちばん上に、どの週か（「0w（今週）」。送れば同じ週が見られる書き方）
  if (card.weekTag) head.push({ type: 'text', text: card.weekTag, weight: 'bold', size: 'sm', color: dark, margin: card.alert ? 'md' : 'none' });
  head.push(
    { type: 'text', text: card.facility.name, weight: 'bold', size: 'md', color: dark, wrap: true, margin: card.weekTag ? 'xs' : card.alert ? 'md' : 'none' },
    { type: 'text', text: `${card.title}${part ? `・${part}` : ''}（${card.asOf} 時点）`, size: 'xs', color: sub, wrap: true, margin: 'sm' },
    {
      type: 'box', layout: 'horizontal', spacing: 'md', margin: 'md',
      contents: [
        legendItem(AVAILABILITY_CELL_COLORS.open, '予約できる'),
        legendItem(AVAILABILITY_CELL_COLORS.view, '空き状況のみ・一部'),
        legendItem(AVAILABILITY_CELL_COLORS.closed, '空きなし'),
      ],
    },
  );
  if (card.unknownStatuses && card.unknownStatuses.length) {
    head.push({
      type: 'text', size: 'xxs', color: AVAILABILITY_ALERT_COLORS.band, wrap: true, margin: 'sm',
      text: `見慣れない状態（${card.unknownStatuses.join('・')}）があります。灰色にしているので、サイトで確かめてください。`,
    });
  }
  // 見張る日の欄（今日から先の見張る日の様子）。何枚かに分けたときは1枚目だけ
  if (card.watchStatus && card.watchStatus.length && (!part || part.indexOf('1/') === 0)) {
    const rows = card.watchStatus.map(function (w) {
      return {
        type: 'box', layout: 'baseline', spacing: 'md',
        contents: [
          { type: 'text', text: w.label, size: 'xs', flex: 0, color: dayColor(w), weight: 'bold' },
          { type: 'text', text: w.text, size: 'xs', wrap: true, color: w.open ? AVAILABILITY_ALERT_COLORS.band : faint, weight: w.open ? 'bold' : 'regular' },
        ],
      };
    });
    head.push({
      type: 'box', layout: 'vertical', spacing: 'xs', margin: 'md', paddingAll: '8px', cornerRadius: '4px',
      backgroundColor: card.alert ? AVAILABILITY_PANEL_COLORS.onAlert : AVAILABILITY_PANEL_COLORS.normal,
      contents: [{ type: 'text', text: '見張る日', size: 'xxs', color: sub, weight: 'bold' }].concat(rows),
    });
  }
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
            color: run.state === 'open' ? AVAILABILITY_TEXT_COLORS.onDark : AVAILABILITY_TEXT_COLORS.onLight,
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
    const watched = (card.watchDates || []).indexOf(day.date) >= 0;
    if (dayActivities.length || watched) {
      // 日付の行に「見張る日」の印と「⚽ 15-17時」を添える
      const marks = [{ type: 'text', text: day.label, size: 'xs', color: dayColor(day), weight: 'bold', flex: 0 }];
      if (watched) marks.push({ type: 'text', text: '見張る日', size: 'xxs', color: AVAILABILITY_ALERT_COLORS.band, weight: 'bold', flex: 0 });
      if (dayActivities.length) {
        marks.push({ type: 'text', text: `⚽ ${dayActivities.map(formatAvailabilityActivity_).join(', ')}`, size: 'xxs', color: sub, flex: 0 });
      }
      table.push({ type: 'box', layout: 'baseline', spacing: 'sm', margin: 'md', contents: marks });
    } else {
      table.push({ type: 'text', text: day.label, size: 'xs', color: dayColor(day), weight: 'bold', margin: 'md' });
    }
    courtNames.forEach(function (court, i) {
      table.push(gridRow(courtLabel(court, i), cellsFor(day.date, court, dayActivities, i + 1), 'xs', '14px'));
    });
  });
  if (days.length === 0) {
    table.push({
      type: 'text', size: 'sm', color: faint, wrap: true, margin: 'lg',
      text: card.watchStatus ? 'この時間の空きは、いまはありません' : 'この条件の日はありません',
    });
  }

  // ページ（T-FONTE の管理ページの90日の表）へのリンクがあるボットでは、先の日はページで見るので「次の2週間」は出さない
  const extraButtons = readAvailabilityExtraButtons_(card.facility);
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
      }].concat(extraButtons).concat(card.nextText && !extraButtons.length ? [{
        type: 'button',
        style: 'link',
        height: 'sm',
        action: { type: 'message', label: card.nextLabel || '次の2週間', text: card.nextText },
      }] : []),
    },
  };
  if (card.alert) {
    bubble.styles = { body: { backgroundColor: AVAILABILITY_ALERT_COLORS.background }, footer: { backgroundColor: AVAILABILITY_ALERT_COLORS.background } };
  }
  if (noButtons) delete bubble.footer;
  return bubble;
}

// ---------- 見張る日の登録 ----------

/** 見張る日をしまう Script Property の名前（施設ごと） */
function availabilityWatchKey_(facility) {
  return `AVAILABILITY_WATCH_DATES_${facility.key}`;
}

/** 見張る日（'yyyy-MM-dd' の並び。古い順） */
function readAvailabilityWatchDates_(facility) {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(availabilityWatchKey_(facility));
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); }).sort() : [];
  } catch (err) {
    logAvailabilityError_(err);
    return [];
  }
}

/** 見張る日をしまう（同じ日は1つ、古い順） */
function saveAvailabilityWatchDates_(facility, dates) {
  const list = uniqueAvailabilityValues_(dates).sort();
  PropertiesService.getScriptProperties().setProperty(availabilityWatchKey_(facility), JSON.stringify(list));
  return list;
}

/**
 * 見張る日から過ぎた日（今日より前）を消して、しまい直す。残った日を返す
 *
 * @param {Object} facility
 * @param {Date} now
 * @returns {string[]}
 */
function pruneAvailabilityWatchDates_(facility, now) {
  const today = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  const all = readAvailabilityWatchDates_(facility);
  const future = all.filter(function (date) { return date >= today; });
  if (future.length !== all.length) {
    try {
      saveAvailabilityWatchDates_(facility, future);
    } catch (err) {
      logAvailabilityError_(err);
    }
  }
  return future;
}

/**
 * 「#灘崎 見張り …」：見張る日を見る・入れかえる・足す・消す。過ぎた日は消していく（書いても入れない）。
 * - 「#灘崎 見張り」… いまの見張る日のカード
 * - 「#灘崎 見張り 11/5 12/11」… 入れかえる
 * - 「#灘崎 見張り + 12/24」「#灘崎 見張り 追加 12/24」… 足す
 * - 「#灘崎 見張り - 12/11」「#灘崎 見張り 削除 12/11」… 消す
 * - 「#灘崎 見張り -1/3 +1/13」… 日付ごとに足す・消す（前に付けた + - はその日だけに効く）
 * - 「#灘崎 見張り 全部消す」… 見張るのをやめる（全部の日を見る）
 *
 * @param {Object} request
 * @param {Date} now
 * @returns {Object[]}
 */
function handleAvailabilityWatch_(request, now) {
  const facility = request.facility;
  // 日付ごとに、足すか消すかを見る。「+」「-」を前に付けた日付はその日だけ、
  // 「+」「追加」「-」「削除」だけの言葉は、そのあとの日付ぜんぶに効く。どれもなければ入れかえ
  let mode = null;
  let clear = false;
  const entries = [];
  const bad = [];
  request.watch.tokens.forEach(function (token) {
    if (['+', '＋', '追加', '足す'].indexOf(token) >= 0) { mode = 'add'; return; }
    if (['-', '－', '−', 'ー', '削除', '消す'].indexOf(token) >= 0) { mode = 'remove'; return; }
    if (['全部消す', 'クリア', 'やめる'].indexOf(token) >= 0) { clear = true; return; }
    let t = token;
    let op = mode;
    if (/^[+＋]/.test(t)) { op = 'add'; t = t.slice(1); }
    else if (/^[-－−]/.test(t)) { op = 'remove'; t = t.slice(1); }
    const date = parseAvailabilityDate_(t, now);
    if (date) entries.push({ date: date, op: op });
    else bad.push(token);
  });

  const current = pruneAvailabilityWatchDates_(facility, now);
  if (bad.length) {
    return [buildAvailabilityWatchCard_(facility, current, now, `「${bad.join(' ')}」は日付として読めませんでした。何も変えていません。`)];
  }
  if (request.watch.tokens.length === 0) {
    return [buildAvailabilityWatchCard_(facility, current, now, '')];
  }
  if (clear) {
    const cleared = saveAvailabilityWatchDates_(facility, []);
    return [buildAvailabilityWatchCard_(facility, cleared, now, '見張る日を全部消しました。')];
  }
  if (entries.length === 0) {
    return [buildAvailabilityWatchCard_(facility, current, now, '日付を書いてください（例: 12/11 12/17）。')];
  }

  const today = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  const notes = [];
  const replace = entries.every(function (e) { return e.op === null; });
  // 入れかえと足すときは、過ぎた日は入れない
  const adding = entries.filter(function (e) { return e.op !== 'remove'; }).map(function (e) { return e.date; });
  const past = adding.filter(function (d) { return d < today; });
  const added = adding.filter(function (d) { return d >= today; });
  const removing = entries.filter(function (e) { return e.op === 'remove'; }).map(function (e) { return e.date; });

  let next;
  if (replace) {
    next = added;
    notes.push('見張る日を入れかえました。');
  } else {
    const missing = removing.filter(function (d) { return current.indexOf(d) < 0; });
    const removed = removing.filter(function (d) { return current.indexOf(d) >= 0; });
    next = current.filter(function (d) { return removing.indexOf(d) < 0; }).concat(added);
    if (added.length) notes.push(`${added.map(formatAvailabilityDate_).join(' ')} を足しました。`);
    if (removed.length) notes.push(`${removed.map(formatAvailabilityDate_).join(' ')} を消しました。`);
    if (missing.length) notes.push(`${missing.map(formatAvailabilityDate_).join(' ')} はもともと入っていません。`);
  }
  if (past.length) notes.push(`${past.map(formatAvailabilityDate_).join(' ')} は過ぎているので入れませんでした。`);
  next = saveAvailabilityWatchDates_(facility, next);
  return [buildAvailabilityWatchCard_(facility, next, now, notes.join('\n'))];
}

/**
 * 見張る日のカード。日付の一覧（過ぎた日は消してある）と、いまの日付をそのまま写せるボタン・いま空きを見るボタン。
 * ボタンはあとで押されても困らない（写すだけ）。
 */
function buildAvailabilityWatchCard_(facility, dates, now, note) {
  const dark = AVAILABILITY_TEXT_COLORS.dark;
  const sub = AVAILABILITY_TEXT_COLORS.sub;
  const faint = AVAILABILITY_TEXT_COLORS.faint;
  const short = function (date) { const p = date.split('-').map(Number); return `${p[1]}/${p[2]}`; };
  const command = `#${facility.key} 見張り`;
  const copyText = dates.length ? `${command} ${dates.map(short).join(' ')}` : `${command} `;

  const body = [
    { type: 'text', text: `${facility.key}の見張る日`, weight: 'bold', size: 'md', color: dark },
    { type: 'text', text: '毎日の空きのカードで、この日に空きがあれば目立つ色で知らせます。', size: 'xs', color: sub, wrap: true, margin: 'sm' },
  ];
  if (note) body.push({ type: 'text', text: note, size: 'sm', color: dark, wrap: true, margin: 'md' });
  body.push({ type: 'separator', margin: 'md' });
  if (dates.length === 0) {
    body.push({ type: 'text', text: 'まだありません', size: 'sm', color: faint, wrap: true, margin: 'md' });
  } else {
    dates.forEach(function (date) {
      body.push({ type: 'text', size: 'sm', margin: 'sm', color: dark, weight: 'bold', text: formatAvailabilityDate_(date) });
    });
  }
  body.push({
    type: 'text', size: 'xxs', color: faint, wrap: true, margin: 'lg',
    text: [`入れかえ: ${command} 12/11 12/17`, `足す: ${command} + 12/24`, `消す: ${command} - 12/11`, `やめる: ${command} 全部消す`].join('\n'),
  });

  const listText = dates.length ? dates.map(short).join(' ') : 'なし';
  return {
    type: 'flex',
    altText: `${facility.key}の見張る日: ${listText}`.slice(0, 400),
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: body },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [{
          type: 'button', style: 'link', height: 'sm',
          action: { type: 'clipboard', label: 'いまの日付をコピー', clipboardText: copyText.slice(0, 1000) },
        }].concat(facility.digestWindow ? [{
          // 書きかえたあと、そのまま空きを確かめる（押されるたびにその時の空きを取るので、あとで押されても困らない）
          type: 'button', style: 'link', height: 'sm',
          action: { type: 'message', label: 'いま空きを見る', text: `#${facility.key} これから ${facility.digestWindow}` },
        }] : []),
      },
    },
  };
}

// ---------- 小さな道具（書き方・時刻・日付） ----------

/** 2, 4 → 「2-4w」、1, 2 → 「1w」（ボタンで送る文に使う。どちらも parseAvailabilityWeeks_ で読める） */
function formatAvailabilityWeeks_(from, to) {
  return to - from === 1 ? `${from}w` : `${from}-${to}w`;
}

/** カードの上の札：1週間なら「0w（今週）」「1w（来週）」「2w（再来週）」「3w」、2週間なら「2-4w」 */
function formatAvailabilityWeekTag_(from, weeks) {
  if (weeks !== 1) return `${from}-${from + weeks}w`;
  const names = ['今週', '来週', '再来週'];
  return names[from] ? `${from}w（${names[from]}）` : `${from}w`;
}

/** [0, 6] → 「土日」、[0, 6, 7] → 「土日祝」、平日5つ → 「平日」 */
function formatAvailabilityDays_(days) {
  if (days.length === 5 && [1, 2, 3, 4, 5].every(function (d) { return days.indexOf(d) >= 0; })) return '平日';
  const order = function (d) { return d === 0 ? 7 : d === AVAILABILITY_HOLIDAY ? 8 : d; };
  return days.slice().sort(function (x, y) { return order(x) - order(y); })
    .map(function (d) { return d === AVAILABILITY_HOLIDAY ? '祝' : AVAILABILITY_WEEKDAYS[d]; }).join('');
}

/** '2026-12-11' → 「12/11(金)」。祝日なら「11/23(月・祝)」 */
function formatAvailabilityDate_(date, holidays) {
  const d = new Date(`${date}T00:00:00Z`);
  const holiday = holidays && holidays[date] ? '・祝' : '';
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${AVAILABILITY_WEEKDAYS[d.getUTCDay()]}${holiday})`;
}

/** 日付の文字の色の種類：日曜・祝日は red、土曜は blue、ほかは '' */
function availabilityDayTone_(date, holidays) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if ((holidays && holidays[date]) || weekday === 0) return 'red';
  return weekday === 6 ? 'blue' : '';
}

/** 活動1つの「17-19時 ①②」（コートがわからなければ時間だけ） */
function formatAvailabilityActivity_(activity) {
  const courts = (activity.courts || []).map(function (n) { return AVAILABILITY_COURT_MARKS[n - 1] || String(n); }).join('');
  return courts ? `${formatAvailabilityWindow_(activity)} ${courts}` : formatAvailabilityWindow_(activity);
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

/** 同じ値を1つにする（並びは最初に出た順） */
function uniqueAvailabilityValues_(list) {
  return list.filter(function (x, i, all) { return all.indexOf(x) === i; });
}

/** 取れなかったわけを残す。Log に error がない環境でも止まらない */
function logAvailabilityError_(err) {
  const detail = { where: 'availability', detail: String((err && err.stack) || err) };
  if (typeof Log !== 'undefined' && Log && typeof Log.error === 'function') Log.error(detail);
  else console.error(JSON.stringify(detail));
}
