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
    els.addBtn.hidden = name !== "main" || view === "field";
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
    els.list.appendChild(createMonthScroller(visible, today, createMonthCard));
}

/** 送信されるカードと同じ、月ごとのカード（見出し・予定の行・リンクのボタン） */
function createMonthCard(month, monthRecords, today) {
    const label = document.createElement("span");
    label.textContent = `${Number(month.slice(5, 7))}月の予定`;
    const head = [label, createButton("共通リンク", "btn btn-small", () => editMonthLink(month))];
    const card = createRecordCard("month-card", head, monthRecords, today, createRowItem);

    const foot = createMonthLinkFoot(month);
    if (foot) {
        card.appendChild(foot);
    } else {
        const note = document.createElement("p");
        note.className = "month-card-note unset";
        note.textContent = "共通リンクが未設定です";
        card.appendChild(note);
    }
    return card;
}

/** 行の管理用の操作（複製・編集・削除） */
function createRowOps(record) {
    const ops = document.createElement("div");
    ops.className = "row-ops";
    ops.append(
        createButton("複製", "btn btn-small", () => openEditor(record, true)),
        createButton("編集", "btn btn-small", () => openEditor(record, false)),
        createButton("削除", "btn btn-small btn-danger", () => removeRecord(record))
    );
    return ops;
}

/** リストの予定1件（日時・内容・場所・リンク・複製・編集・削除）。保存した直後の予定は目立たせる */
function createRowItem(record, today) {
    return createRecordRow(record, today, recordKey(record) === flashKey ? " is-flash" : "", createRowOps(record));
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

try {
    const saved = localStorage.getItem("admin-view");
    if (saved === "list" || saved === "field") view = saved;
} catch (err) { /* 保存できなくても動く */ }

function setView(next) {
    view = next;
    try { localStorage.setItem("admin-view", next); } catch (err) { /* 保存できなくても動く */ }
    applyView();
}

/** カレンダー・リスト・空きの表示を切りかえる（空きは予定の操作がないので、ツールバーと追加ボタンを隠す） */
function applyView() {
    const isField = view === "field";
    els.list.hidden = view !== "list";
    $("calendar").hidden = view !== "calendar";
    $("field").hidden = !isField;
    $("toolbar").hidden = isField;
    $("pastLabel").hidden = view !== "list";
    els.addBtn.hidden = isField || els.main.hidden;
    [["tabCal", "calendar"], ["tabList", "list"], ["tabField", "field"]].forEach(([id, name]) => {
        $(id).classList.toggle("is-active", view === name);
        $(id).setAttribute("aria-selected", String(view === name));
    });
    if (isField && !field.loaded && !field.loading) loadField();
}

// ---------- 空き（灘崎の今日から90日。開いたときに読む） ----------

const FIELD_COURT_MARKS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
const FIELD_STATE_NAMES = { open: "予約できる", view: "空き状況のみ・一部", closed: "うまっている", none: "時間の外" };
const field = { loaded: false, loading: false, data: null, error: "", onlyOpen: false };

try { field.onlyOpen = localStorage.getItem("admin-field-only-open") === "1"; } catch (err) { /* 保存できなくても動く */ }

/** GAS からサイトの空き状況を読む（開くたび・「読みなおす」のたびにサイトを読む） */
async function loadField() {
    field.loading = true;
    field.error = "";
    renderField();
    try {
        const result = await callApi("availability");
        if (!result.ok) throw new Error(result.message);
        field.data = result.availability;
        field.loaded = true;
    } catch (err) {
        console.error(err);
        field.error = "読み込みに失敗しました。通信状況を確認してください。";
    }
    field.loading = false;
    renderField();
}

/** 空きのタブを描く：時点・リンク・見張る日・色の見方・日ごとのマス */
function renderField() {
    const root = $("field");
    const p = field.data;
    const head = document.createElement("div");
    head.className = "field-head";
    const asOf = document.createElement("span");
    asOf.className = "field-asof";
    asOf.textContent = field.loading ? "読み込み中..." : p && p.asOf ? `${formatFieldTime(p.asOf)} 時点` : "";
    const actions = document.createElement("div");
    actions.className = "toolbar-actions";
    if (p && p.pageUrl) actions.appendChild(createAnswerLink("予約サイト", p.pageUrl, "btn btn-small"));
    actions.appendChild(createButton("読みなおす", "btn btn-small", loadField, field.loading));
    head.append(asOf, actions);
    const children = [head];

    if (field.error) children.push(fieldNotice(field.error));
    else if (p && p.status !== "ok") children.push(fieldNotice(p.message || "空き状況を読めませんでした。"));
    else if (p) children.push(...renderFieldBody(p));
    root.replaceChildren(...children);
}

function fieldNotice(text) {
    const note = document.createElement("div");
    note.className = "empty";
    note.textContent = text;
    return note;
}

/** 見張る日・しぼりこみ・色の見方・マスの表 */
function renderFieldBody(p) {
    const parts = [];
    if (p.watch && p.watch.length) parts.push(createFieldWatch(p.watch));

    const filter = document.createElement("label");
    filter.className = "field-filter";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = field.onlyOpen;
    check.addEventListener("change", () => {
        field.onlyOpen = check.checked;
        try { localStorage.setItem("admin-field-only-open", field.onlyOpen ? "1" : "0"); } catch (err) { /* 保存できなくても動く */ }
        renderField();
    });
    filter.append(check, " 空きのある日だけ");
    parts.push(filter, createFieldLegend());

    const days = p.days.filter(day => !field.onlyOpen || day.open);
    if (!days.length) {
        parts.push(fieldNotice(field.onlyOpen ? "空きのある日はありません。" : "サイトから日付を読めませんでした。"));
        return parts;
    }
    parts.push(createFieldGrid(p, days));
    const last = p.days[p.days.length - 1];
    const note = document.createElement("p");
    note.className = "field-note";
    note.textContent = `サイトに出ているのは ${last.label} まで。⚽ は予定（場所が灘崎）のある時間。`;
    parts.push(note);
    return parts;
}

/** 見張る日（LINE の「#灘崎 見張り」で登録した日）の様子。空きがあればオレンジ */
function createFieldWatch(watch) {
    const box = document.createElement("div");
    box.className = "field-watch";
    const title = document.createElement("strong");
    title.textContent = "見張る日";
    box.appendChild(title);
    watch.forEach(item => {
        const row = document.createElement("div");
        row.className = `field-watch-row${item.open ? " is-open" : ""}`;
        const date = document.createElement("span");
        date.className = `field-tone-${item.tone || "normal"}`;
        date.textContent = item.label;
        const text = document.createElement("span");
        text.textContent = item.text;
        row.append(date, text);
        box.appendChild(row);
    });
    return box;
}

function createFieldLegend() {
    const legend = document.createElement("div");
    legend.className = "field-legend";
    ["open", "view", "closed"].forEach(state => {
        const item = document.createElement("span");
        const swatch = document.createElement("i");
        swatch.className = `field-cell is-${state}`;
        item.append(swatch, FIELD_STATE_NAMES[state]);
        legend.appendChild(item);
    });
    return legend;
}

/**
 * マスの表。列は1時間ずつ、行は日ごと・コートごと（①②）。月がかわるところに見出し。
 * 見張る日は日付をオレンジの印、予定のある時間は ⚽
 */
function createFieldGrid(p, days) {
    const table = document.createElement("div");
    table.className = "field-grid";
    table.style.setProperty("--hours", String(p.hours.length));

    const scale = document.createElement("div");
    scale.className = "field-row field-scale";
    scale.appendChild(document.createElement("span"));
    p.hours.forEach((minutes, i) => {
        const label = document.createElement("span");
        label.textContent = i % 2 === 0 ? String(minutes / 60) : "";
        scale.appendChild(label);
    });
    table.appendChild(scale);

    let month = "";
    days.forEach(day => {
        if (day.date.slice(0, 7) !== month) {
            month = day.date.slice(0, 7);
            const head = document.createElement("div");
            head.className = "field-month";
            head.textContent = `${Number(month.slice(5, 7))}月`;
            table.appendChild(head);
        }
        table.appendChild(createFieldDay(p, day));
    });
    return table;
}

/** 1日ぶん（コートの数だけ行がある） */
function createFieldDay(p, day) {
    const block = document.createElement("div");
    block.className = `field-day${day.watched ? " is-watched" : ""}${day.open ? "" : " is-closed"}`;
    p.courts.forEach((court, index) => {
        const row = document.createElement("div");
        row.className = "field-row";
        const label = document.createElement("span");
        label.className = "field-date";
        if (index === 0) {
            const date = document.createElement("span");
            date.className = `field-tone-${day.tone || "normal"}`;
            date.textContent = day.label;
            label.appendChild(date);
        }
        const mark = document.createElement("span");
        mark.className = "field-mark";
        mark.textContent = p.courts.length > 1 ? FIELD_COURT_MARKS[index] || "" : "";
        label.appendChild(mark);
        row.appendChild(label);

        (day.cells[court] || []).forEach((state, i) => {
            const cell = document.createElement("span");
            cell.className = `field-cell is-${state}`;
            const start = p.hours[i];
            const playing = (day.activities || []).some(a => a.start < start + 60 && a.end > start
                && (!a.courts.length || a.courts.includes(index + 1)));
            if (playing) cell.textContent = "⚽";
            cell.title = `${day.label} ${FIELD_COURT_MARKS[index] || court} ${start / 60}時 ${FIELD_STATE_NAMES[state] || ""}`;
            row.appendChild(cell);
        });
        block.appendChild(row);
    });
    return block;
}

/** 「2026-11-10T08:05:00+09:00」→「11/10 8:05」 */
function formatFieldTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
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
        createButton("◀", "btn", () => shiftCalMonth(-1)),
        title,
        createButton("▶", "btn", () => shiftCalMonth(1))
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
    const cell = createDayCell(date, day, dayRecords, today, date === selectedDate);
    cell.setAttribute("aria-label", `${date}${dayRecords.length ? `（予定${dayRecords.length}件）` : ""}`);
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

/** 選んだ日の予定のカード（「＋ この日に追加」つき） */
function createDayPanel(date, dayRecords, today) {
    const label = document.createElement("span");
    label.textContent = formatDayLabel(date);
    const head = [label, createButton("＋ この日に追加", "btn btn-small", () => openEditor(null, false, date))];
    return createRecordCard("month-card day-panel", head, dayRecords, today, createRowItem);
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
$("tabField").addEventListener("click", () => setView("field"));
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
