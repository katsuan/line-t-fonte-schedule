// 予定の管理（admin.html）の入口。LIFF の中で開く（管理者だけ）。
// 予定の一覧（カレンダー・リスト）・追加・編集・削除・文章でまとめて追加・カレンダー同期を、GAS（doPost）に送る。
// 月の表の部品は js/month-calendar.js（先に読む）。

const LIFF_ID = "2009927582-9QtOstUK";
const GAS_URL = "https://script.google.com/macros/s/AKfycbzXgPNJkiAB4eGVUwExQ8ehA8wMM93rSGk8OcvZe-1fo6ozalkr4Ov83KCwouA5WN1K/exec";

const $ = id => document.getElementById(id);
const els = {
    loading: $("loading"), forbidden: $("forbidden"), fatal: $("fatal"), fatalMessage: $("fatalMessage"),
    main: $("main"), list: $("list"), showPast: $("showPast"), addBtn: $("addBtn"),
    editor: $("editor"), form: $("form"), formTitle: $("formTitle"), formError: $("formError"),
    saveBtn: $("saveBtn"), toast: $("toast")
};

let records = [];
let editing = null; // 編集中の予定（追加のときは null）
let endTouched = false; // 終了を自分で入力したら、開始を変えても上書きしない
let commonPref = true; // 「月の共通リンクを使う」の希望（共通リンクのない月では一時的に使えなくなる）
let toastTimer = null;

// ---------- 通信 ----------

async function callApi(action, payload = {}) {
    const response = await fetch(GAS_URL, {
        method: "POST",
        // text/plain にして CORS のプリフライトを避ける（GAS は OPTIONS を受けられない）
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, accessToken: liff.getAccessToken(), ...payload })
    });
    return response.json();
}

// ---------- 起動 ----------

async function start() {
    show("loading");
    try {
        await liff.init({ liffId: LIFF_ID });
        if (!liff.isLoggedIn()) {
            liff.login({ redirectUri: location.href });
            return;
        }

        const who = await callApi("whoami");
        if (!who.ok) return fail(who.message);
        if (!who.isAdmin) {
            $("userId").textContent = who.userId;
            return show("forbidden");
        }

        await loadRecords();
        applyView();
        show("main");
    } catch (err) {
        console.error(err);
        fail("読み込みに失敗しました。通信状況を確認してください。");
    }
}

/** 画面を1つだけ出す（読みこみ中・管理者でない・エラー・本体） */
function show(name) {
    ["loading", "forbidden", "fatal", "main"].forEach(key => { els[key].hidden = key !== name; });
    els.addBtn.hidden = name !== "main";
}

/** エラーの画面を出す */
function fail(message) {
    els.fatalMessage.textContent = message || "エラーが発生しました。";
    show("fatal");
}

/** GAS から予定の一覧を読む */
async function loadRecords() {
    const result = await callApi("list");
    if (!result.ok) throw new Error(result.message);
    applyRecords(result.records);
}

/** 予定の一覧を日時の順にして、画面と入力の候補を作り直す */
function applyRecords(next) {
    records = next.slice().sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    render();
    renderSuggestions();
}

// ---------- 描画 ----------

function render() {
    renderList();
    renderCalendar();
}

/** リストの表示（月ごと。過ぎた予定はチェックのときだけ） */
function renderList() {
    const today = todayKey();
    const visible = records.filter(r => els.showPast.checked || r.date >= today);
    els.list.replaceChildren();

    if (!visible.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "予定はありません。右下の「＋ 予定を追加」から登録できます。";
        els.list.appendChild(empty);
        return;
    }

    const byMonth = new Map();
    visible.forEach(record => {
        const month = record.date.slice(0, 7);
        if (!byMonth.has(month)) byMonth.set(month, []);
        byMonth.get(month).push(record);
    });

    const scroller = document.createElement("div");
    scroller.className = "month-scroller";
    byMonth.forEach((monthRecords, month) => scroller.appendChild(createMonthCard(month, monthRecords, today)));
    els.list.appendChild(scroller);
}

/** 送信されるカードと同じ、月ごとのカード（見出し・予定の行・リンクのボタン） */
function createMonthCard(month, monthRecords, today) {
    const card = document.createElement("section");
    card.className = "month-card";

    const head = document.createElement("div");
    head.className = "month-card-head";
    const label = document.createElement("span");
    label.textContent = `${Number(month.slice(5, 7))}月の予定`;
    head.append(label, actionButton("共通リンク", "btn btn-small", () => editMonthLink(month)));

    const body = document.createElement("div");
    body.className = "month-card-body";
    monthRecords.forEach(record => body.appendChild(createRowItem(record, today)));
    card.append(head, body);

    const monthLink = baseLinkFor(month);
    if (monthLink) {
        const foot = document.createElement("div");
        foot.className = "month-card-foot";
        const open = document.createElement("a");
        open.className = "btn btn-answer";
        open.href = monthLink;
        open.target = "_blank";
        open.rel = "noopener noreferrer";
        open.textContent = `${Number(month.slice(5, 7))}月のリンクを開く`;
        foot.appendChild(open);
        card.appendChild(foot);
    } else {
        const note = document.createElement("p");
        note.className = "month-card-note unset";
        note.textContent = "共通リンクが未設定です";
        card.appendChild(note);
    }
    return card;
}

/** 管理用の操作（カレンダー追加・複製・編集・削除）。月の共通リンクと違うリンクはここで示す */
function createRowActions(record) {
    const links = document.createElement("div");
    links.className = "row-links";
    // その予定だけ別のリンクならそれを、なければ月の共通リンクを開く
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
    links.appendChild(createCalendarLink(record));

    const ops = document.createElement("div");
    ops.className = "row-ops";
    ops.append(
        actionButton("複製", "btn btn-small", () => openEditor(record, true)),
        actionButton("編集", "btn btn-small", () => openEditor(record, false)),
        actionButton("削除", "btn btn-small btn-danger", () => removeRecord(record))
    );

    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.append(links, ops);
    return actions;
}

/** リストの予定1件（日時・内容・場所・編集・削除・カレンダー） */
function createRowItem(record, today) {
    const [y, m, d] = record.date.split("-").map(Number);
    const weekday = new Date(y, m - 1, d).getDay();
    const { icon: iconText, title: titleText } = splitMemoIcon(record.memo1);

    const row = document.createElement("article");
    row.className = `row-item${record.date < today ? " past" : ""}${recordKey(record) === flashKey ? " is-flash" : ""}`;
    row.dataset.key = recordKey(record);

    const icon = document.createElement("div");
    icon.className = "row-icon";
    icon.textContent = iconText;

    const body = document.createElement("div");
    body.className = "row-body";

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

    const dateLine = document.createElement("p");
    dateLine.className = "row-meta";
    const dow = document.createElement("span");
    dow.className = weekday === 0 ? "sun" : weekday === 6 ? "sat" : "";
    dow.textContent = `(${WEEKDAYS[weekday]})`;
    dateLine.append(
        document.createTextNode(`${m}月${d}日`),
        dow,
        document.createTextNode(` ${record.start}${record.end ? `-${record.end}` : ""}`)
    );

    const placeLine = document.createElement("p");
    placeLine.className = "row-meta";
    placeLine.textContent = [record.place, record.memo2].filter(Boolean).join(" ");

    body.append(head, dateLine, placeLine);
    const actions = createRowActions(record);
    if (actions) body.appendChild(actions);

    row.append(icon, body);
    return row;
}

/** 月の共通リンクを入れなおす */
async function editMonthLink(month) {
    const current = baseLinkFor(month);
    const input = prompt(
        `${monthLabel(month)}の共通リンク\n（別のリンクを入れている予定は、そのままにします）`,
        current
    );
    if (input === null) return;

    const link = input.trim();
    if (!/^https?:\/\//.test(link)) return showToast("http(s):// から入力してください", true);
    if (link === current) return;

    try {
        const result = await callApi("setMonthLink", { month, fromLink: current, link });
        if (!result.ok) return showToast(result.message || "更新できませんでした", true);
        applyRecords(result.records);
        showSaved("共通リンクを更新しました", result);
    } catch (err) {
        console.error(err);
        showToast("通信に失敗しました", true);
    }
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

/** 予定を自分の Google カレンダーに入れるリンク */
function createCalendarLink(record) {
    const link = document.createElement("a");
    link.className = "btn btn-small btn-calendar";
    link.href = createCalendarLinkUrl(record);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "📅 カレンダー追加";
    return link;
}

/** ボタンを作る */
function actionButton(label, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
}

const OTHER = "__other__";
const FREQUENT_LIMIT = 8;
const choices = {
    place: { sel: $("fPlaceSel"), input: $("fPlace"), values: [] },
    memo1: { sel: $("fMemo1Sel"), input: $("fMemo1"), values: [] }
};

/** よく使う順（同数なら新しい予定のもの）に、上位だけをプルダウンへ出す */
function frequentValues(field) {
    const counts = new Map();
    records.forEach(record => {
        const value = record[field];
        if (value) counts.set(value, (counts.get(value) || 0) + 1);
    });
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, FREQUENT_LIMIT)
        .map(([value]) => value);
}

/** 場所・内容の候補を、よく使う順に作り直す */
function renderSuggestions() {
    Object.entries(choices).forEach(([field, choice]) => {
        choice.values = frequentValues(field);
        buildChoiceOptions(choice);
    });
}

/** 候補の選択肢（候補・その他）を作る */
function buildChoiceOptions(choice) {
    const make = (value, label) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        return option;
    };
    choice.sel.replaceChildren(
        make("", "選んでください"),
        ...choice.values.map(value => make(value, value)),
        make(OTHER, "その他（入力する）")
    );
}

/** 候補の欄に値を入れる（候補になければ「その他」に入れる） */
function setChoiceValue(choice, value) {
    const text = value || "";
    if (!text) {
        choice.sel.value = "";
        choice.input.value = "";
        choice.input.hidden = true;
    } else if (choice.values.includes(text)) {
        choice.sel.value = text;
        choice.input.value = "";
        choice.input.hidden = true;
    } else {
        choice.sel.value = OTHER;
        choice.input.value = text;
        choice.input.hidden = false;
    }
}

/** 候補の欄の値（「その他」なら入力した文字） */
function getChoiceValue(choice) {
    return (choice.sel.value === OTHER ? choice.input.value : choice.sel.value).trim();
}

Object.values(choices).forEach(choice => {
    choice.sel.addEventListener("change", () => {
        const isOther = choice.sel.value === OTHER;
        choice.input.hidden = !isOther;
        if (isOther) choice.input.focus();
    });
});

// ---------- カレンダー表示 ----------

let view = "calendar"; // 公開ページと同じく、カレンダー → リストの順で、カレンダーが初期表示
let calMonth = todayKey().slice(0, 7);
let selectedDate = "";
let flashKey = ""; // 保存・登録した直後の予定（見える位置に出して、目立たせる）

try { if (localStorage.getItem("admin-view") === "list") view = "list"; } catch (err) { /* 保存できなくても動く */ }

function setView(next) {
    view = next;
    try { localStorage.setItem("admin-view", next); } catch (err) { /* 保存できなくても動く */ }
    applyView();
}

/** カレンダーとリストの表示を切りかえる */
function applyView() {
    const isCalendar = view === "calendar";
    els.list.hidden = isCalendar;
    $("calendar").hidden = !isCalendar;
    $("pastLabel").hidden = isCalendar;
    $("tabList").classList.toggle("is-active", !isCalendar);
    $("tabCal").classList.toggle("is-active", isCalendar);
    $("tabList").setAttribute("aria-selected", String(!isCalendar));
    $("tabCal").setAttribute("aria-selected", String(isCalendar));
}

/** カレンダーの月を前・次に動かす */
function shiftCalMonth(delta) {
    const [y, m] = calMonth.split("-").map(Number);
    const next = new Date(y, m - 1 + delta, 1);
    calMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
    selectedDate = "";
    renderCalendar();
}

/** カレンダー（月の表・週のはじまり・選んだ日の予定）を描く */
function renderCalendar() {
    const root = $("calendar");
    const today = todayKey();
    const byDate = groupRecordsByDate(records);

    const nav = document.createElement("div");
    nav.className = "cal-nav";
    const title = document.createElement("span");
    title.className = "cal-title";
    title.textContent = monthLabel(calMonth);
    nav.append(
        actionButton("◀", "btn", () => shiftCalMonth(-1)),
        title,
        actionButton("▶", "btn", () => shiftCalMonth(1))
    );

    const grid = createMonthGrid(calMonth, byDate, today, createCalendarCell);

    const children = [nav, grid, createWeekStartToggle()];
    const dayRecords = byDate.get(selectedDate) || [];
    if (selectedDate.startsWith(calMonth) && dayRecords.length) {
        children.push(createDayPanel(selectedDate, dayRecords, today));
    }
    root.replaceChildren(...children);
}

/** カレンダーの1日のマス（押すとその日の予定を出す） */
function createCalendarCell(date, day, dayRecords, today) {
    const weekday = new Date(date.replaceAll("-", "/")).getDay();
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = ["cal-cell",
        weekday === 0 ? "sun" : weekday === 6 ? "sat" : "",
        dayRecords.length ? "has-events" : "",
        date === today ? "today" : "",
        date < today ? "past" : "",
        date === selectedDate ? "selected" : ""].filter(Boolean).join(" ");
    cell.setAttribute("aria-label", `${date}${dayRecords.length ? `（予定${dayRecords.length}件）` : ""}`);

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

    cell.addEventListener("click", () => onDayTap(date, dayRecords));
    return cell;
}

/** 予定のない日はそのまま追加フォームへ。予定のある日は、その日の予定と「この日に追加」を出す */
function onDayTap(date, dayRecords) {
    selectedDate = date;
    renderCalendar();
    if (!dayRecords.length) openEditor(null, false, date);
    else revealDayPanel();
}

/**
 * 保存・登録した予定を見せる。いまの画面の外（別の月・画面の下）に追加されても、結果が見えないと不安なので、
 * その月・その日に移して、見える位置まで動かし、少しのあいだ目立たせる。
 * @param {Object[]} saved 保存した予定（まとめて登録したときは、いちばん早い日の予定を見せる）
 */
function revealSaved(saved) {
    const target = saved.slice().sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))[0];
    if (!target) return;

    const match = records.find(record => recordKey(record) === recordKey(target));
    if (!match) return; // 見つからなければ、何もしない（同期の都合で並びが変わったときなど）

    if (match.date < todayKey()) els.showPast.checked = true; // 過去の日付は、リストでは初期状態だと隠れている
    calMonth = match.date.slice(0, 7);
    selectedDate = match.date;
    flashKey = recordKey(match);
    render();

    const row = [...document.querySelectorAll(".row-item.is-flash")].find(el => el.offsetParent !== null);
    if (row) (row.closest(".month-card") || row).scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
    setTimeout(() => {
        flashKey = "";
        document.querySelectorAll(".row-item.is-flash").forEach(el => el.classList.remove("is-flash"));
    }, 2500);
}

/** 選んだ日の予定のカード */
function createDayPanel(date, dayRecords, today) {
    const [y, m, d] = date.split("-").map(Number);
    const card = document.createElement("section");
    card.className = "month-card day-panel";

    const head = document.createElement("div");
    head.className = "month-card-head";
    const label = document.createElement("span");
    label.textContent = `${m}月${d}日(${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`;
    head.append(label, actionButton("＋ この日に追加", "btn btn-small", () => openEditor(null, false, date)));

    const body = document.createElement("div");
    body.className = "month-card-body";
    dayRecords.forEach(record => body.appendChild(createRowItem(record, today)));

    card.append(head, body);
    return card;
}

// ---------- 追加・編集 ----------

function openEditor(record, asCopy, presetDate) {
    editing = record && !asCopy ? record : null;
    els.formTitle.textContent = editing ? "予定を編集" : asCopy ? "予定を複製して追加" : "予定を追加";
    const source = record || {};
    $("fDate").value = asCopy ? "" : (source.date || presetDate || todayKey());
    $("fStart").value = source.start || "";
    $("fEnd").value = source.end || "";
    // すでに終了時刻がある予定はそのまま。追加や、終了が空の予定は、開始を入れたときに2時間後を入れる
    endTouched = !!source.end;
    setChoiceValue(choices.place, source.place);
    setChoiceValue(choices.memo1, source.memo1);
    $("fMemo2").value = source.memo2 || "";
    // 回答リンク: 月の共通リンクと同じ（または空）なら「共通リンクを使う」、違えばその予定だけのリンク
    const linkMonth = (source.date || $("fDate").value).slice(0, 7);
    commonPref = !record || !source.link || source.link === baseLinkFor(linkMonth);
    $("fLink").value = commonPref ? "" : source.link;
    syncLinkField();
    setFormError("");
    els.editor.showModal();
    els.formTitle.focus({ preventScroll: true });
}

/** 開始時刻の2時間後（日をまたがないよう、23:59までに収める） */
function defaultEndFor(start) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(start || "");
    if (!match) return "";
    const total = Math.min(Number(match[1]) * 60 + Number(match[2]) + DEFAULT_DURATION_HOURS * 60, 23 * 60 + 59);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** 終了を自分で変えていなければ、開始の2時間後にする */
function applyDefaultEnd() {
    if (endTouched) return;
    const end = defaultEndFor($("fStart").value);
    if (end) $("fEnd").value = end;
}

/** 日付の月に合わせて、「共通リンクを使う」のトグルとリンク欄の表示を整える */
function syncLinkField() {
    const date = $("fDate").value;
    const month = date ? date.slice(0, 7) : "";
    const base = month ? baseLinkFor(month) : "";
    const box = $("fLinkCommon");
    const note = $("fLinkNote");

    $("fLinkCommonText").textContent = month ? `${Number(month.slice(5, 7))}月の共通リンクを使う` : "月の共通リンクを使う";
    box.disabled = !base;
    box.checked = !!base && commonPref;
    $("fLink").hidden = box.checked;

    if (box.checked) {
        note.textContent = base;
        note.hidden = false;
    } else if (!base) {
        note.textContent = month
            ? "この月の共通リンクはまだありません。入力したリンクは、この予定だけのリンクになります。"
            : "日付を選ぶと、その月の共通リンクを使えます。";
        note.hidden = false;
    } else {
        note.hidden = true;
    }
}

/** 保存するリンク: 共通リンクを使うならその月の共通リンク、そうでなければ入力したリンク */
function readLinkField() {
    if (!$("fLinkCommon").checked) return $("fLink").value.trim();
    const date = $("fDate").value;
    return date ? baseLinkFor(date.slice(0, 7)) : "";
}

/** 入力のまちがいを出す（空なら消す） */
function setFormError(message) {
    els.formError.textContent = message;
    els.formError.hidden = !message;
}

/** 入力の欄から予定を読む */
function readForm() {
    return {
        date: $("fDate").value,
        start: $("fStart").value,
        end: $("fEnd").value,
        place: getChoiceValue(choices.place),
        memo1: getChoiceValue(choices.memo1),
        memo2: $("fMemo2").value.trim(),
        link: readLinkField()
    };
}

/** 「保存」を押したとき：追加か編集を GAS に送る */
async function saveForm(event) {
    event.preventDefault();
    const record = readForm();
    if (!record.date || !record.start || !record.place || !record.memo1) {
        return setFormError("日付・開始・場所・内容は必須です。");
    }

    els.saveBtn.disabled = true;
    setFormError("");
    try {
        const result = editing
            ? await callApi("update", { rowNumber: editing.rowNumber, expected: stripRow(editing), record })
            : await callApi("add", { record });
        if (!result.ok) return handleApiFailure(result, true);

        applyRecords(result.records);
        els.editor.close();
        revealSaved([record]);
        showSaved(editing ? "更新しました" : "追加しました", result);
    } catch (err) {
        console.error(err);
        setFormError("通信に失敗しました。もう一度お試しください。");
    } finally {
        els.saveBtn.disabled = false;
    }
}

// ---------- 削除 ----------

async function removeRecord(record) {
    const label = `${record.date} ${record.start} ${record.memo1}`;
    if (!confirm(`この予定を削除しますか？\n${label}`)) return;

    try {
        const result = await callApi("delete", { rowNumber: record.rowNumber, expected: stripRow(record) });
        if (!result.ok) return handleApiFailure(result, false);
        applyRecords(result.records);
        showSaved("削除しました", result);
    } catch (err) {
        console.error(err);
        showToast("通信に失敗しました", true);
    }
}

/** 予定から行の番号を外す（画面が見ていた内容として送るため） */
function stripRow(record) {
    const { rowNumber, ...fields } = record;
    return fields;
}

/** 保存・削除が断られたときの知らせ（シートが変わっていれば読み直す） */
async function handleApiFailure(result, inForm) {
    if (result.code === "stale") {
        // シートが変わっている。最新を読み直してから、やり直してもらう
        try { await loadRecords(); } catch (err) { console.error(err); }
        els.editor.close();
        return showToast(result.message, true);
    }
    if (inForm) return setFormError(result.message || "保存できませんでした。");
    showToast(result.message || "失敗しました", true);
}

// ---------- 文章でまとめて追加（入力 → 分解 → 確認 → 登録） ----------

let bulkRecords = []; // 読み取った予定の候補（確認画面で、チェックを外したものは登録しない）

/** 「文章で追加」の段階（入力・確認）を切りかえる */
function setBulkStep(step) {
    $("bulkStepInput").hidden = step !== "input";
    $("bulkStepConfirm").hidden = step !== "confirm";
}

/** 「文章で追加」の知らせを出す（空なら消す） */
function setBulkMessage(id, message) {
    $(id).textContent = message;
    $(id).hidden = !message;
}

/** 「文章で追加」を開く */
function openBulk() {
    setBulkStep("input");
    setBulkMessage("bulkError", "");
    $("bulkDialog").showModal();
    $("bulkTitle").focus({ preventScroll: true }); // 入力欄に自動で当たると、キーボードが先に出てしまう
}

/** 文章を、サーバーのパーサ（チャットの #予定登録 と同じ）で予定に分解して、確認画面に出す */
async function parseBulk() {
    const text = $("bulkText").value;
    if (!text.trim()) return setBulkMessage("bulkError", "予定の文章を入力してください。");

    $("bulkParse").disabled = true;
    setBulkMessage("bulkError", "");
    try {
        const result = await callApi("parseSchedule", { text });
        if (!result.ok) return setBulkMessage("bulkError", result.message || "読み取れませんでした。");
        if (!result.records.length) {
            return setBulkMessage("bulkError", result.errors.length
                ? `読み取れる予定がありませんでした。\n${formatBulkErrors(result.errors)}`
                : "読み取れる予定がありませんでした。「日付 開始〜終了 場所 内容」の順に書いてください。");
        }
        bulkRecords = result.records.map(record => ({ ...record, checked: !record.duplicate }));
        renderBulkConfirm(result);
        setBulkStep("confirm");
    } catch (err) {
        console.error(err);
        setBulkMessage("bulkError", "通信に失敗しました。もう一度お試しください。");
    } finally {
        $("bulkParse").disabled = false;
    }
}

/** 読み取れなかった行を並べる */
function formatBulkErrors(errors) {
    return errors.map(error => `${error.lineNumber}行目: 「${error.raw}」`).join("\n");
}

/** 読み取った予定の確認を出す（登録済みと同じものはチェックを外す） */
function renderBulkConfirm(result) {
    const notes = [];
    if (result.autoFilledCount) notes.push(`${result.autoFilledCount}件は、同じ月の既存リンクを入れました。`);
    if (result.truncated) notes.push("多いため、先頭の50件だけ読み取りました。");
    $("bulkSummary").textContent = `${bulkRecords.length}件読み取りました。この内容で登録しますか？${notes.length ? `\n${notes.join("")}` : ""}`;
    $("bulkSummary").style.whiteSpace = "pre-line";

    $("bulkList").replaceChildren(...bulkRecords.map((record, index) => createBulkItem(record, index)));

    const errors = result.errors || [];
    $("bulkErrors").textContent = errors.length ? `読み取れなかった行（登録されません）\n${formatBulkErrors(errors)}` : "";
    $("bulkErrors").style.whiteSpace = "pre-line";
    $("bulkErrors").hidden = !errors.length;
    setBulkMessage("bulkConfirmError", "");
    updateBulkSubmit();
}

/** 確認の予定1件（チェック・日時・内容・場所・印） */
function createBulkItem(record, index) {
    const [y, m, d] = record.date.split("-").map(Number);
    const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];

    const item = document.createElement("label");
    item.className = `bulk-item${record.checked ? "" : " is-off"}`;

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = record.checked;
    box.addEventListener("change", () => {
        bulkRecords[index].checked = box.checked;
        item.classList.toggle("is-off", !box.checked);
        updateBulkSubmit();
    });

    const body = document.createElement("div");
    body.className = "bulk-item-body";

    const when = document.createElement("div");
    when.className = "bulk-item-when";
    when.textContent = `${m}/${d}(${weekday}) ${record.start}-${record.end}`;
    if (record.endIsDefault) when.appendChild(createBulkTag("終了は2時間後"));
    if (record.duplicate) when.appendChild(createBulkTag("登録済みと同じ", true));

    const what = document.createElement("div");
    what.className = "bulk-item-what";
    what.textContent = [record.memo1, record.memo2].filter(Boolean).join(" ");

    const sub = document.createElement("div");
    sub.className = "bulk-item-sub";
    sub.textContent = `📍 ${record.place}　${record.link ? "🔗 リンクあり" : "🔗 リンクなし"}`;

    body.append(when, what, sub);
    item.append(box, body);
    return item;
}

/** 確認の予定に付ける小さな印 */
function createBulkTag(text, warn = false) {
    const tag = document.createElement("span");
    tag.className = `bulk-tag${warn ? " warn" : ""}`;
    tag.textContent = text;
    return tag;
}

/** 登録のボタンの文字と、押せるかを、チェックの数に合わせる */
function updateBulkSubmit() {
    const count = bulkRecords.filter(record => record.checked).length;
    $("bulkSubmit").textContent = count ? `${count}件を登録する` : "登録する";
    $("bulkSubmit").disabled = count === 0;
}

/** 確認した内容を登録する（チェックを外した予定は登録しない） */
async function submitBulk() {
    const records = bulkRecords.filter(record => record.checked).map(record => ({
        date: record.date, start: record.start, end: record.end,
        place: record.place, memo1: record.memo1, memo2: record.memo2, link: record.link
    }));
    if (!records.length) return;

    $("bulkSubmit").disabled = true;
    setBulkMessage("bulkConfirmError", "");
    try {
        const result = await callApi("addBatch", { records });
        if (!result.ok) {
            setBulkMessage("bulkConfirmError", result.message || "登録できませんでした。");
            return updateBulkSubmit();
        }
        applyRecords(result.records);
        $("bulkText").value = "";
        $("bulkDialog").close();
        revealSaved(records);
        showSaved(`${records.length}件を登録しました`, result);
    } catch (err) {
        console.error(err);
        setBulkMessage("bulkConfirmError", "通信に失敗しました。もう一度お試しください。");
        updateBulkSubmit();
    }
}

/** 保存の完了を知らせる。Googleカレンダーの同期に失敗していたら、保存は成功したうえで、そのことも伝える */
function showSaved(message, result) {
    const calendar = result && result.calendar;
    if (calendar && !calendar.ok && !calendar.skipped) {
        console.warn("calendar sync failed:", calendar.message);
        return showToast(`${message}（カレンダー同期は失敗しました）`, true);
    }
    showToast(message);
}

/** 今すぐ、シートの今日以降の予定をGoogleカレンダーに合わせる */
async function syncCalendarNow() {
    const button = $("syncBtn");
    button.disabled = true;
    try {
        const result = await callApi("syncCalendar");
        if (!result.ok) return showToast(result.message || "同期できませんでした", true);
        const calendar = result.calendar || {};
        if (calendar.skipped && !calendar.ok) return showToast("カレンダー同期は未設定です（CALENDAR_ID）", true);
        showToast(calendar.ok ? `カレンダーに同期しました（${calendar.message}）` : (calendar.message || "同期に失敗しました"), !calendar.ok);
    } catch (err) {
        console.error(err);
        showToast("通信に失敗しました", true);
    } finally {
        button.disabled = false;
    }
}

/** 画面の下に短い知らせを出す */
function showToast(message, isError = false) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.className = `toast${isError ? " error" : ""}`;
    els.toast.hidden = false;
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2800);
}

// ---------- イベント ----------

els.form.addEventListener("submit", saveForm);
$("fDate").addEventListener("change", syncLinkField);
$("fStart").addEventListener("input", applyDefaultEnd);
$("fStart").addEventListener("change", applyDefaultEnd);
$("fEnd").addEventListener("input", () => { endTouched = true; });
$("fLinkCommon").addEventListener("change", () => {
    commonPref = $("fLinkCommon").checked;
    syncLinkField();
    if (!commonPref) $("fLink").focus();
});
$("cancelBtn").addEventListener("click", () => els.editor.close());
els.addBtn.addEventListener("click", () => openEditor(null, false, view === "calendar" ? selectedDate : ""));
setupCalendarSwipe($("calendar"), delta => shiftCalMonth(delta));
$("tabList").addEventListener("click", () => setView("list"));
$("tabCal").addEventListener("click", () => setView("calendar"));
els.showPast.addEventListener("change", render);
$("retryBtn").addEventListener("click", start);
$("syncBtn").addEventListener("click", syncCalendarNow);
$("bulkBtn").addEventListener("click", openBulk);
$("bulkCancel").addEventListener("click", () => $("bulkDialog").close());
$("bulkParse").addEventListener("click", parseBulk);
$("bulkBack").addEventListener("click", () => { setBulkStep("input"); $("bulkText").focus(); });
$("bulkSubmit").addEventListener("click", submitBulk);
$("reloadBtn").addEventListener("click", async () => {
    try { await loadRecords(); showToast("最新にしました"); } catch (err) { showToast("読み込みに失敗しました", true); }
});
$("copyUserId").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("userId").textContent); showToast("コピーしました"); } catch (err) { showToast("コピーできませんでした", true); }
});

start();
