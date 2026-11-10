// 公開の活動予定カレンダー（calendar.html）の入口。ログインなしで開ける。
// GAS（doGet ?action=plans）から今月からの予定を読み、カレンダー・リスト・次回のカウントダウンを出す。
// 前に読んだ内容は端末に残し、次に開いたとき先に出す。月の表の部品は js/month-calendar.js（先に読む）。

// GAS_URL は js/config.js（先に読む）

const $ = id => document.getElementById(id);

let records = [];
let view = "calendar";
let calMonth = "";
let selectedDate = "";
let selectedKey = ""; // 選択状態にしている予定（上部の「次回」をタップしたとき）
let renderedDay = ""; // 最後に描いた日（日付が変わったら描き直すため）

// ---------- 読み込み ----------

// 前回の内容を端末に残しておき、次に開いたときは、それを先に出す（GASの応答が数秒かかるため）。
// 裏で最新を取って、変わっていたときだけ差し替える。取れなかったときも、前回の内容を見せる。
const CACHE_KEY = "t_fonte_public_calendar_v1";
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 古すぎる内容は、先に出さない
const AUTO_REFRESH_AFTER_MS = 5 * 60 * 1000;      // 開いたままのページに戻ったとき、これ以上古ければ更新する
let loadingNow = false;
let lastUpdatedAt = 0;
let lastSubscribeUrl = "";

/** 端末に残した前の予定を読む（古すぎれば使わない） */
function readCache() {
    try {
        const data = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
        if (!data || !Array.isArray(data.records) || typeof data.savedAt !== "number") return null;
        return Date.now() - data.savedAt > CACHE_MAX_AGE_MS ? null : data;
    } catch (err) {
        return null;
    }
}

/** 読んだ予定を端末に残す */
function writeCache(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (err) { /* 保存できなくても動く */ }
}

/** 今日なら「12:34」、それ以前なら「10/21 12:34」 */
function formatClock(ms) {
    const d = new Date(ms);
    const two = n => String(n).padStart(2, "0");
    const clock = `${two(d.getHours())}:${two(d.getMinutes())}`;
    return d.toDateString() === new Date().toDateString() ? clock : `${d.getMonth() + 1}/${d.getDate()} ${clock}`;
}

/** 「最終更新」などの知らせを出す */
function setStatus(text, isWarn = false) {
    $("statusText").textContent = text;
    $("statusLine").classList.toggle("warn", isWarn);
}

/** 予定を反映して描画する。keepView なら、いま見ている月・日・タブはそのまま */
function applyData(data, keepView) {
    records = data.records;
    lastSubscribeUrl = data.subscribeUrl || "";
    setSubscribeLink(lastSubscribeUrl);
    if (!keepView) {
        calMonth = todayKey().slice(0, 7);
        selectedDate = "";
        selectedKey = "";
    }
    $("loading").hidden = true;
    $("error").hidden = true;
    $("main").hidden = false;
    render();
    updateNextBar();
}

/** 予定を読む：前の内容を先に出し、GAS から最新を読んで、変わっていれば描き直す */
async function load() {
    if (loadingNow) return;
    loadingNow = true;
    $("refreshBtn").disabled = true;

    const alreadyShowing = !$("main").hidden;
    const cached = alreadyShowing ? null : readCache();
    if (cached) {
        lastUpdatedAt = cached.savedAt;
        applyData(cached, false);
    } else if (!alreadyShowing) {
        $("loading").hidden = false;
        $("error").hidden = true;
        $("main").hidden = true;
    }
    const hasData = alreadyShowing || !!cached;
    if (hasData) setStatus("更新しています…");

    try {
        const response = await fetch(`${GAS_URL}?action=plans`);
        const data = await response.json();
        if (!data.ok) throw new Error(data.message || "取得できませんでした");

        const subscribeUrl = data.subscribeUrl || "";
        const changed = !hasData || JSON.stringify(records) !== JSON.stringify(data.records) || lastSubscribeUrl !== subscribeUrl;
        lastUpdatedAt = Date.now();
        writeCache({ records: data.records, subscribeUrl, savedAt: lastUpdatedAt });
        if (changed) applyData(data, hasData);
        setStatus(`最終更新 ${formatClock(lastUpdatedAt)}`);
    } catch (err) {
        console.error(err);
        if (hasData) {
            setStatus(`最新を取得できませんでした（${formatClock(lastUpdatedAt)} 時点の内容です）`, true);
        } else {
            $("loading").hidden = true;
            $("errorMessage").textContent = "予定を読み込めませんでした。";
            $("error").hidden = false;
        }
    } finally {
        loadingNow = false;
        $("refreshBtn").disabled = false;
    }
}

/** 登録リンクがあるときだけ、ページ下部に出す（リンクは https://calendar.google.com/ のものに限る） */
function setSubscribeLink(url) {
    const button = $("subscribeLink");
    const valid = typeof url === "string" && url.startsWith("https://calendar.google.com/");
    button.hidden = !valid;
    if (!valid) return;

    $("subGoogle").href = url;

    // iPhone の標準カレンダー用: 登録リンクの cid（カレンダーIDの base64）から、公開 iCal の webcal:// を作る。
    // cid はすでに公開されているので、新しく ID が露出することはない。専用カレンダーの形式のときだけ作る。
    const webcalUrl = buildWebcalUrl(url);
    const isApple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
    $("subApple").hidden = !(webcalUrl && isApple);
    if (webcalUrl) $("subApple").href = webcalUrl;

    // 端末に合うほうを先頭に（iPhone・Mac は標準カレンダー、それ以外は Google カレンダー）
    if (!$("subApple").hidden) $("subOptions").prepend($("subApple"));
}

/** iPhone の標準カレンダーで登録するための webcal:// のリンク（作れなければ空文字） */
function buildWebcalUrl(subscribeUrl) {
    try {
        const cid = decodeURIComponent(new URL(subscribeUrl).searchParams.get("cid") || "");
        const calendarId = atob(cid + "=".repeat((4 - cid.length % 4) % 4));
        if (!/^[^@\s]+@(group|import)\.calendar\.google\.com$/i.test(calendarId)) return "";
        return `webcal://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
    } catch (err) {
        return "";
    }
}

/** LINEのアプリ内ブラウザ（UAに「Line/」が入る）では、Googleのログインが引き継がれず、追加が完了しにくい */
function isLineInAppBrowser() {
    return /\bLine\//i.test(navigator.userAgent);
}

/** このページのURLをコピーする（パソコンなどで開き直すため）。コピーが使えない環境では、選択して手動コピーできるよう案内する */
async function copyPageUrl() {
    const url = location.origin + location.pathname;
    const button = $("subCopy");
    const original = button.textContent;
    let copied = false;
    try {
        await navigator.clipboard.writeText(url);
        copied = true;
    } catch (err) {
        const input = document.createElement("textarea");
        input.value = url;
        // 16px 未満だと、iPhone が選んだときに画面を拡大してしまう
        input.style.cssText = "position:fixed;opacity:0;font-size:16px";
        document.body.appendChild(input);
        input.select();
        try { copied = document.execCommand("copy"); } catch (e) { copied = false; }
        input.remove();
    }
    button.textContent = copied ? "✔ コピーしました" : url;
    setTimeout(() => { button.textContent = original; }, 2500);
}

/** 「カレンダーに登録」のシートを開く */
function openSubscribeSheet() {
    $("subLineWarn").hidden = !isLineInAppBrowser();
    $("subscribeDialog").showModal();
    $("subTitle").focus({ preventScroll: true });
}

// ---------- 描画 ----------

function render() {
    renderedDay = todayKey();
    $("calendar").hidden = view !== "calendar";
    $("list").hidden = view !== "list";
    $("tabCal").classList.toggle("is-active", view === "calendar");
    $("tabList").classList.toggle("is-active", view === "list");
    $("tabCal").setAttribute("aria-selected", String(view === "calendar"));
    $("tabList").setAttribute("aria-selected", String(view === "list"));
    renderCalendar();
    renderList();
}

/**
 * 開いたままのページに戻ったとき、日付が変わっていれば描き直す（「今日」の印・過ぎた日・残り日数）。
 * 見ていた月が先月になっていたら、今月に移す
 */
function refreshIfDayChanged() {
    if ($("main").hidden || renderedDay === todayKey()) return;
    const thisMonth = todayKey().slice(0, 7);
    if (calMonth < thisMonth) {
        calMonth = thisMonth;
        selectedDate = "";
        selectedKey = "";
    }
    render();
}

/** 今月から、予定のある最後の月までが動ける範囲 */
function monthRange() {
    const first = todayKey().slice(0, 7);
    const last = records.reduce((max, r) => (r.date.slice(0, 7) > max ? r.date.slice(0, 7) : max), first);
    return { first, last };
}

/** カレンダーの月を前・次に動かす（今月から予定のある月まで） */
function shiftMonth(delta) {
    const [y, m] = calMonth.split("-").map(Number);
    const next = new Date(y, m - 1 + delta, 1);
    const target = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
    const { first, last } = monthRange();
    if (target < first || target > last) return;
    calMonth = target;
    selectedDate = "";
    selectedKey = "";
    renderCalendar();
}

/** カレンダー（月の表・週のはじまり・月のリンク・選んだ日の予定）を描く */
function renderCalendar() {
    const today = todayKey();
    const { first: thisMonth, last: lastMonth } = monthRange();
    const month = Number(calMonth.slice(5, 7));
    const byDate = groupRecordsByDate(records);

    const title = document.createElement("span");
    title.className = "cal-title";
    title.textContent = monthLabel(calMonth);
    const nav = document.createElement("div");
    nav.className = "cal-nav";
    nav.append(
        createButton("◀", "btn", () => shiftMonth(-1), calMonth <= thisMonth),
        title,
        createButton("▶", "btn", () => shiftMonth(1), calMonth >= lastMonth)
    );

    const grid = createMonthGrid(calMonth, byDate, today, createCell);

    const children = [nav, grid, createWeekStartToggle()];
    const monthLink = baseLinkFor(calMonth);
    if (monthLink) {
        const bar = document.createElement("div");
        bar.className = "answer-bar";
        bar.appendChild(createAnswerLink(`📝 ${month}月の回答リンクを開く`, monthLink, "btn btn-answer"));
        children.push(bar);
    }
    const dayRecords = byDate.get(selectedDate) || [];
    if (selectedDate.startsWith(calMonth) && dayRecords.length) {
        children.push(createDayPanel(selectedDate, dayRecords, today));
    } else if (![...byDate.keys()].some(date => date.startsWith(calMonth))) {
        const hint = document.createElement("p");
        hint.className = "hint";
        hint.textContent = "この月の予定はまだありません。";
        children.push(hint);
    } else {
        const hint = document.createElement("p");
        hint.className = "hint";
        hint.textContent = "色のついた日をタップすると、予定が表示されます。";
        children.push(hint);
    }
    $("calendar").replaceChildren(...children);
}

/** カレンダーの1日のマス（予定があれば押せる） */
function createCell(date, day, dayRecords, today) {
    const cell = createDayCell(date, day, dayRecords, today, date === selectedDate);
    if (dayRecords.length) {
        cell.setAttribute("aria-label", `${date} 予定${dayRecords.length}件`);
        cell.addEventListener("click", () => {
            selectedDate = date;
            selectedKey = "";
            renderCalendar();
            revealDayPanel();
        });
    }
    return cell;
}

/** 選んだ日の予定のカード */
function createDayPanel(date, dayRecords, today) {
    return createRecordCard("month-card day-panel", [formatDayLabel(date)], dayRecords, today, createRowItem);
}

/** リストの表示（月ごとのカード） */
function renderList() {
    const root = $("list");
    root.replaceChildren();

    if (!records.length) {
        const empty = document.createElement("div");
        empty.className = "notice";
        empty.textContent = "予定はまだありません。";
        root.appendChild(empty);
        return;
    }
    root.appendChild(createMonthScroller(records, todayKey(), createMonthCard));
}

/** 1か月分の予定のカード（月のリンクつき） */
function createMonthCard(month, monthRecords, today) {
    const card = createRecordCard("month-card", [`${Number(month.slice(5, 7))}月の予定`], monthRecords, today, createRowItem);
    const foot = createMonthLinkFoot(month);
    if (foot) card.appendChild(foot);
    return card;
}

/** リストの予定1件（日時・内容・場所・リンク・カレンダー）。上の「次回」から選んだ予定は目立たせる */
function createRowItem(record, today) {
    return createRecordRow(record, today, recordKey(record) === selectedKey ? " is-selected" : "", null);
}

// ---------- 次回の予定（カウントダウン）と選択 ----------

function timeMs(date, time) {
    const [y, m, d] = date.split("-").map(Number);
    const [hh, mm] = String(time || "0:0").split(":").map(Number);
    return new Date(y, m - 1, d, hh, mm).getTime();
}

/** 予定が終わる時刻（ミリ秒） */
function recordEndMs(record) {
    const startMs = timeMs(record.date, record.start);
    const endMs = record.end ? timeMs(record.date, record.end) : 0;
    return endMs > startMs ? endMs : startMs + DEFAULT_DURATION_HOURS * 3600000;
}

/** 終わっていない最初の予定（開催中の予定を含む） */
function findNextRecord(now) {
    return records.find(record => recordEndMs(record) > now) || null;
}

/** 残り時間を「あと2日3時間24分05秒」の形にする（大きい単位が0なら省く。桁が揺れないよう分・秒は2桁） */
function formatCountdown(ms) {
    const totalSeconds = Math.max(Math.floor(ms / 1000), 0);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const two = n => String(n).padStart(2, "0");
    if (days > 0) return `あと${days}日${hours}時間${two(minutes)}分${two(seconds)}秒`;
    if (hours > 0) return `あと${hours}時間${two(minutes)}分${two(seconds)}秒`;
    if (minutes > 0) return `あと${minutes}分${two(seconds)}秒`;
    return `あと${seconds}秒`;
}

/** 上の「次回」の予定とカウントダウンを出す */
function updateNextBar() {
    const bar = $("nextBar");
    const now = Date.now();
    const next = findNextRecord(now);
    bar.hidden = !next || $("main").hidden;
    if (!next) return;

    const [y, m, d] = next.date.split("-").map(Number);
    const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
    $("nextWhen").textContent = `${m}/${d}(${weekday}) ${next.start}`;
    $("nextWhat").textContent = [next.memo1, next.place].filter(Boolean).join(" ");

    const startMs = timeMs(next.date, next.start);
    const inProgress = now >= startMs;
    $("nextCount").textContent = inProgress ? "開催中" : formatCountdown(startMs - now);
    $("nextCount").classList.toggle("now", inProgress);
}

/** 次回の予定のカードを選択状態にして、見える位置へ移す */
function selectNextRecord() {
    const next = findNextRecord(Date.now());
    if (!next) return;

    calMonth = next.date.slice(0, 7);
    selectedDate = next.date;
    selectedKey = recordKey(next);
    render();

    const row = [...document.querySelectorAll(".row-item.is-selected")].find(el => el.offsetParent !== null);
    if (!row) return;
    // リストは横スクロールの月カードごと、カレンダーは下に出る日付のカードごと見える位置へ
    (row.closest(".month-card") || row).scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
}

// ---------- イベント ----------

setupCalendarSwipe($("calendar"), delta => shiftMonth(delta));
$("tabCal").addEventListener("click", () => { view = "calendar"; render(); });
$("tabList").addEventListener("click", () => { view = "list"; render(); });
$("retryBtn").addEventListener("click", load);
$("refreshBtn").addEventListener("click", load);
$("subscribeLink").addEventListener("click", openSubscribeSheet);
$("subClose").addEventListener("click", () => $("subscribeDialog").close());
$("subCopy").addEventListener("click", copyPageUrl);
$("nextBar").addEventListener("click", selectNextRecord);
setInterval(updateNextBar, 1000);
document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    refreshIfDayChanged();
    updateNextBar();
    // 開いたままのページに戻ってきたとき、しばらく前の内容なら、裏で更新する
    if (lastUpdatedAt && Date.now() - lastUpdatedAt > AUTO_REFRESH_AFTER_MS) load();
});

load();
