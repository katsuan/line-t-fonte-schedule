// 月の表（カレンダー）の部品。公開カレンダー（calendar.js）と管理ページ（admin.js）で同じもの。
// 曜日・週のはじまり（日曜／月曜。端末に残す）・マスの予定・アイコンの文字・月のリンク・左右のスワイプ。
// calendar.html・admin.html から、それぞれの入口より先に読む（同じ範囲の変数と関数を使う、ふつうの script）。

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

// 終了時刻の初期値（管理ページ）と、終了時刻がない・開始より前の予定が終わるとみなす時刻（公開カレンダー）は、開始の何時間後か。
// GAS の DEFAULT_PLAN_DURATION_HOURS（カレンダー同期）と同じ
const DEFAULT_DURATION_HOURS = 2;

/** 今日の「2026-11-02」 */
function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 「2026年11月」の文字 */
function monthLabel(month) {
    return `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;
}

/** 予定を見分けるキー（日付・開始・場所・内容） */
function recordKey(record) {
    return `${record.date} ${record.start} ${record.place} ${record.memo1}`;
}

/** 今日からの残り日数の表示（過ぎた予定は「終了」） */
function untilLabel(dateKey) {
    const [y, m, d] = dateKey.split("-").map(Number);
    const now = new Date();
    const days = Math.round((new Date(y, m - 1, d) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
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
        const date = `${month}-${String(day).padStart(2, "0")}`;
        grid.appendChild(createCell(date, day, byDate.get(date) || [], today));
    }
    return grid;
}

/** 月の表の曜日の見出し（週のはじまりから7つ）。曜日の番号は getDay() と同じ（0=日曜） */
function appendWeekdayHeads(grid) {
    for (let i = 0; i < 7; i++) {
        const index = (weekStart + i) % 7;
        const dow = document.createElement("div");
        dow.className = `cal-dow${index === 0 ? " sun" : index === 6 ? " sat" : ""}`;
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
