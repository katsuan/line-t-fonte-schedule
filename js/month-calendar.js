// 月の表（カレンダー）と予定の行の部品。公開カレンダー（calendar.js）と管理ページ（admin.js）で同じもの。
// 曜日・週のはじまり（日曜／月曜。端末に残す）・マス・アイコンの文字・月のリンク・左右のスワイプ・
// 予定の行（内容・日時・場所・回答リンク・カレンダー追加）・月のカードと選んだ日のカード。
// calendar.html・admin.html から、それぞれの入口より先に読む（同じ範囲の変数と関数を使う、ふつうの script）。

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

// 終了時刻の初期値（管理ページ）と、終了時刻がない・開始より前の予定が終わるとみなす時刻（公開カレンダー）は、開始の何時間後か。
// GAS の DEFAULT_PLAN_DURATION_HOURS（カレンダー同期）と同じ
const DEFAULT_DURATION_HOURS = 2;

/** 2けたにそろえる（9 → "09"） */
function pad2(n) {
    return String(n).padStart(2, "0");
}

/** Date から「2026-11-02」 */
function toDateKey(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 今日の「2026-11-02」 */
function todayKey() {
    return toDateKey(new Date());
}

/** 「2026-11-02」を、その日の 0:00 の Date にする */
function parseDateKey(dateKey) {
    const [y, m, d] = dateKey.split("-").map(Number);
    return new Date(y, m - 1, d);
}

/** 「2026-11」から delta か月ずらした「2026-12」 */
function addMonths(month, delta) {
    const [y, m] = month.split("-").map(Number);
    const next = new Date(y, m - 1 + delta, 1);
    return `${next.getFullYear()}-${pad2(next.getMonth() + 1)}`;
}

/** 「2026-11」の月の数（11） */
function monthNumberOf(month) {
    return Number(month.slice(5, 7));
}

/** 「2026年11月」の文字 */
function monthLabel(month) {
    return `${month.slice(0, 4)}年${monthNumberOf(month)}月`;
}

/** 曜日の番号（0=日曜）から、色の印（"sun"・"sat"・""） */
function weekdayClass(weekday) {
    return weekday === 0 ? "sun" : weekday === 6 ? "sat" : "";
}

/** 予定を見分けるキー（日付・開始・場所・内容） */
function recordKey(record) {
    return `${record.date} ${record.start} ${record.place} ${record.memo1}`;
}

/** 今日からの残り日数の表示（過ぎた予定は「終了」） */
function untilLabel(dateKey) {
    const days = Math.round((parseDateKey(dateKey) - parseDateKey(todayKey())) / 86400000);
    if (days < 0) return { text: "終了", className: "done" };
    if (days === 0) return { text: "今日", className: "today" };
    return { text: `あと${days}日`, className: "" };
}

/** 内容の先頭が絵文字なら、アイコン欄に出す分を題名から外す（送信されるカードと同じ見せ方） */
function splitMemoIcon(memo) {
    const text = String(memo || "").trim();
    const match = /^(\p{Extended_Pictographic}\uFE0F?)\s*/u.exec(text);
    return match ? { icon: match[1], title: text.slice(match[0].length) || text } : { icon: iconOf(text), title: text };
}

/** 先頭の1文字（絵文字なども1つの文字として数える） */
function firstGrapheme(text) {
    if (window.Intl && Intl.Segmenter) {
        return new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(text)[Symbol.iterator]().next().value.segment;
    }
    return Array.from(text)[0];
}

/** 内容の1文字目（絵文字は1つの文字として）をアイコンにする */
function iconOf(memo) {
    const text = String(memo || "").trim();
    return text ? firstGrapheme(text) : "📅";
}

/** その月で一番よく使われているリンクを、月の共通（回答）リンクとみなす（同数なら後に登録されたもの） */
function baseLinkFor(month) {
    const counts = new Map();
    records.forEach(record => {
        if (record.date.slice(0, 7) === month && record.link) {
            counts.set(record.link, (counts.get(record.link) || 0) + 1);
        }
    });
    let best = "";
    let bestCount = 0;
    counts.forEach((count, link) => {
        if (count >= bestCount) { best = link; bestCount = count; }
    });
    return best;
}

/** 別のタブで開くリンクのボタン */
function createAnswerLink(label, href, className = "btn btn-small btn-answer") {
    const link = document.createElement("a");
    link.className = className;
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = label;
    return link;
}

/** カレンダーを左右にスワイプして月を移動する（縦スクロールと区別するため、横の動きが十分大きいときだけ） */
function setupCalendarSwipe(root, onSwipe) {
    let start = null;
    root.addEventListener("touchstart", event => {
        const touch = event.touches[0];
        start = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
    }, { passive: true });
    root.addEventListener("touchcancel", () => { start = null; }, { passive: true });
    root.addEventListener("touchend", event => {
        if (!start) return;
        const touch = event.changedTouches[0];
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        start = null;
        if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        onSwipe(dx < 0 ? 1 : -1);
    }, { passive: true });
}

/** マス目に出す予定1件分: 「アイコン＋場所の1文字目」と「開始時刻」 */
function createCellEvent(record) {
    const item = document.createElement("span");
    item.className = "cal-ev";

    const top = document.createElement("span");
    top.className = "cal-ev-top";
    top.append(document.createTextNode(iconOf(record.memo1)));
    const place = String(record.place || "").trim();
    if (place) {
        const placeChar = document.createElement("span");
        placeChar.className = "cal-ev-place";
        placeChar.textContent = firstGrapheme(place);
        top.appendChild(placeChar);
    }

    const time = document.createElement("span");
    time.className = "cal-ev-time";
    time.textContent = record.start;

    item.append(top, time);
    return item;
}

/** 日付をタップしたとき、その日のカードが画面の外（カレンダーの下）に出るので、見える位置まで動かす */
function revealDayPanel() {
    const panel = document.querySelector(".day-panel");
    if (panel) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/**
 * 印のついた予定の行（".row-item.is-selected" など）のうち、見えているものを見える位置へ移す。
 * リストは横スクロールの月カードごと、カレンダーは下に出る日付のカードごと
 */
function revealMarkedRow(selector) {
    const row = [...document.querySelectorAll(selector)].find(el => el.offsetParent !== null);
    if (row) (row.closest(".month-card") || row).scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
}

const WEEK_START_KEY = "t_fonte_week_start"; // "1" なら月曜はじまり。ないときは日曜はじまり（いままでどおり）

let weekStart = readWeekStart();

/** 端末に残した週のはじまり（1 なら月曜、ほかは日曜） */
function readWeekStart() {
    try { return localStorage.getItem(WEEK_START_KEY) === "1" ? 1 : 0; } catch (err) { return 0; }
}

/** 週のはじまりを変えて端末に残し、カレンダーを描き直す */
function setWeekStart(next) {
    weekStart = next;
    try { localStorage.setItem(WEEK_START_KEY, String(next)); } catch (err) { /* 保存できなくても動く */ }
    renderCalendar();
}

/** 予定を日付ごとにまとめる（"2026-11-02" → その日の予定の並び） */
function groupRecordsByDate(list) {
    const byDate = new Map();
    list.forEach(record => {
        if (!byDate.has(record.date)) byDate.set(record.date, []);
        byDate.get(record.date).push(record);
    });
    return byDate;
}

/**
 * 月の表（曜日の見出し・1日の前の空きマス・日ごとのマス）。month は "2026-11"。
 * マスは createCell(date, day, その日の予定, today) で作る（公開カレンダーと管理ページで、押したときの動きが違うため）
 */
function createMonthGrid(month, byDate, today, createCell) {
    const [year, monthNumber] = month.split("-").map(Number);
    const grid = document.createElement("div");
    grid.className = "cal-grid";
    appendWeekdayHeads(grid);

    for (let i = 0; i < leadingBlankCount(year, monthNumber); i++) {
        const blank = document.createElement("div");
        blank.className = "cal-cell blank";
        grid.appendChild(blank);
    }
    for (let day = 1; day <= new Date(year, monthNumber, 0).getDate(); day++) {
        const date = `${month}-${pad2(day)}`;
        grid.appendChild(createCell(date, day, byDate.get(date) || [], today));
    }
    return grid;
}

/** 月の表の曜日の見出し（週のはじまりから7つ）。曜日の番号は getDay() と同じ（0=日曜） */
function appendWeekdayHeads(grid) {
    for (let i = 0; i < 7; i++) {
        const index = (weekStart + i) % 7;
        const dow = document.createElement("div");
        const tone = weekdayClass(index);
        dow.className = `cal-dow${tone ? ` ${tone}` : ""}`;
        dow.textContent = WEEKDAYS[index];
        grid.appendChild(dow);
    }
}

/** 1日の前に置く空きマスの数 */
function leadingBlankCount(year, month) {
    return (new Date(year, month - 1, 1).getDay() - weekStart + 7) % 7;
}

/** 月の表の下の「週のはじまり 日｜月」 */
function createWeekStartToggle() {
    const wrap = document.createElement("div");
    wrap.className = "week-start";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "週のはじまり");
    const label = document.createElement("span");
    label.textContent = "週のはじまり";
    wrap.appendChild(label);
    [[0, "日"], [1, "月"]].forEach(([value, text]) => {
        const option = document.createElement("button");
        option.type = "button";
        option.textContent = text;
        option.setAttribute("aria-pressed", String(weekStart === value));
        option.setAttribute("aria-label", `${text}曜はじまり`);
        if (weekStart !== value) option.addEventListener("click", () => setWeekStart(value));
        wrap.appendChild(option);
    });
    return wrap;
}

// ---------- 予定の行とカード（リストの月のカード・カレンダーの選んだ日のカード） ----------

/** ボタンを作る */
function createButton(label, className, handler, disabled = false) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = className;
    el.textContent = label;
    el.disabled = disabled;
    el.addEventListener("click", handler);
    return el;
}

/** 予定を月ごとにまとめる（"2026-11" → その月の予定の並び） */
function groupRecordsByMonth(list) {
    const byMonth = new Map();
    list.forEach(record => {
        const month = record.date.slice(0, 7);
        if (!byMonth.has(month)) byMonth.set(month, []);
        byMonth.get(month).push(record);
    });
    return byMonth;
}

/** 月ごとのカードを横に並べる箱。カードは createCard(month, その月の予定, today) で作る */
function createMonthScroller(list, today, createCard) {
    const scroller = document.createElement("div");
    scroller.className = "month-scroller";
    groupRecordsByMonth(list).forEach((monthRecords, month) => scroller.appendChild(createCard(month, monthRecords, today)));
    return scroller;
}

/** 「11月2日(月)」 */
function formatDayLabel(date) {
    const day = parseDateKey(date);
    return `${day.getMonth() + 1}月${day.getDate()}日(${WEEKDAYS[day.getDay()]})`;
}

/**
 * 予定のカード（見出しと、予定の行）。見出しの中身は headParts（文字か部品）。
 * 行は createRow(record, today) で作る（目立たせ方と、行の操作がページごとに違うため）
 */
function createRecordCard(className, headParts, list, today, createRow) {
    const card = document.createElement("section");
    card.className = className;

    const head = document.createElement("div");
    head.className = "month-card-head";
    head.append(...headParts);

    const body = document.createElement("div");
    body.className = "month-card-body";
    list.forEach(record => body.appendChild(createRow(record, today)));

    card.append(head, body);
    return card;
}

/** 月のカードの下の「11月のリンクを開く」（月の共通リンクがなければ null） */
function createMonthLinkFoot(month) {
    const monthLink = baseLinkFor(month);
    if (!monthLink) return null;
    const foot = document.createElement("div");
    foot.className = "month-card-foot";
    foot.appendChild(createAnswerLink(`${monthNumberOf(month)}月のリンクを開く`, monthLink, "btn btn-answer"));
    return foot;
}

/**
 * 予定1件の行（アイコン・内容・残り日数・日時・場所・リンク）。
 * stateClass は目立たせる印（" is-selected" など。なければ ""）、extraActions はリンクのあとに置く操作（なければ null）
 */
function createRecordRow(record, today, stateClass, extraActions) {
    const { icon: iconText, title: titleText } = splitMemoIcon(record.memo1);

    const row = document.createElement("article");
    row.className = `row-item${record.date < today ? " past" : ""}${stateClass}`;
    row.dataset.key = recordKey(record);

    const icon = document.createElement("div");
    icon.className = "row-icon";
    icon.textContent = iconText;

    const placeLine = document.createElement("p");
    placeLine.className = "row-meta";
    placeLine.textContent = [record.place, record.memo2].filter(Boolean).join(" ");

    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.appendChild(createRowLinks(record));
    if (extraActions) actions.appendChild(extraActions);

    const body = document.createElement("div");
    body.className = "row-body";
    body.append(createRowHead(record, titleText), createRowDateLine(record), placeLine, actions);

    row.append(icon, body);
    return row;
}

/** 行の見出し（内容と「あと○日」） */
function createRowHead(record, titleText) {
    const head = document.createElement("div");
    head.className = "row-head";
    const title = document.createElement("h3");
    title.className = "row-title";
    title.textContent = titleText;
    const until = untilLabel(record.date);
    const badge = document.createElement("span");
    badge.className = `row-until${until.className ? ` ${until.className}` : ""}`;
    badge.textContent = until.text;
    head.append(title, badge);
    return head;
}

/** 行の日時「11月2日(月) 10:00-12:00」（曜日は土日に色） */
function createRowDateLine(record) {
    const day = parseDateKey(record.date);
    const weekday = day.getDay();
    const dateLine = document.createElement("p");
    dateLine.className = "row-meta";
    const dow = document.createElement("span");
    dow.className = weekdayClass(weekday);
    dow.textContent = `(${WEEKDAYS[weekday]})`;
    dateLine.append(
        document.createTextNode(`${day.getMonth() + 1}月${day.getDate()}日`),
        dow,
        document.createTextNode(` ${record.start}${record.end ? `-${record.end}` : ""}`)
    );
    return dateLine;
}

/** 行のリンク（回答リンクとカレンダー追加）。その予定だけ別のリンクならそれを、なければ月の共通リンクを開く */
function createRowLinks(record) {
    const links = document.createElement("div");
    links.className = "row-links";
    const baseLink = baseLinkFor(record.date.slice(0, 7));
    const answerLink = record.link || baseLink;
    if (answerLink) {
        const isCommon = answerLink === baseLink;
        links.appendChild(createAnswerLink(
            "📝 回答リンク",
            answerLink,
            isCommon ? "btn btn-small btn-answer-soft" : "btn btn-small btn-answer"
        ));
    }
    links.appendChild(createAnswerLink("📅 カレンダー追加", createCalendarLinkUrl(record), "btn btn-small btn-calendar"));
    return links;
}

/** Googleカレンダーに予定を追加するリンク（送信カードの「カレンダー追加」と同じ内容） */
function createCalendarLinkUrl(record) {
    const compact = (date, time) => `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;
    const end = record.end || record.start;
    const params = [
        "action=TEMPLATE",
        `text=${encodeURIComponent(record.memo1 || "予定")}`,
        `dates=${encodeURIComponent(`${compact(record.date, record.start)}/${compact(record.date, end)}`)}`,
        `location=${encodeURIComponent(record.place || "")}`,
        `details=${encodeURIComponent(record.memo2 || "")}`,
        "ctz=Asia%2FTokyo"
    ];
    return `https://calendar.google.com/calendar/render?${params.join("&")}`;
}

/**
 * カレンダーの1日のマス（日付・予定2件まで・+○）。予定があるかで押したときの動きがページごとに違うので、
 * 押したときの動きと読み上げの名前は、呼んだページで付ける
 */
function createDayCell(date, day, dayRecords, today, isSelected) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = ["cal-cell",
        weekdayClass(parseDateKey(date).getDay()),
        dayRecords.length ? "has-events" : "",
        date === today ? "today" : "",
        date < today ? "past" : "",
        isSelected ? "selected" : ""].filter(Boolean).join(" ");

    const number = document.createElement("span");
    number.className = "cal-day";
    number.textContent = String(day);
    cell.appendChild(number);

    if (dayRecords.length) {
        const events = document.createElement("span");
        events.className = "cal-events";
        dayRecords.slice(0, 2).forEach(record => events.appendChild(createCellEvent(record)));
        cell.appendChild(events);
        if (dayRecords.length > 2) {
            const more = document.createElement("span");
            more.className = "cal-more";
            more.textContent = `+${dayRecords.length - 2}`;
            cell.appendChild(more);
        }
    }
    return cell;
}
