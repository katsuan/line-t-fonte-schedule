// 管理ページ（admin.html）の「⚽ 空き」タブ：灘崎の今日から90日のマス・見張る日・予定の ⚽・ほかの場所の予定。
// admin.js より先に読む（ここの関数は、呼ばれたときに admin.js の $・callApi と、js/month-calendar.js の createButton・createAnswerLink・monthNumberOf を使う）。
// 管理ページの applyView が、タブを開いたときに loadField を呼ぶ

const FIELD_COURT_MARKS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
const FIELD_STATE_NAMES = { open: "予約できる", view: "空き状況のみ・一部", closed: "うまっている", none: "時間の外" };
const field = { loaded: false, loading: false, data: null, error: "", onlyOpen: false };

try { field.onlyOpen = localStorage.getItem("admin-field-only-open") === "1"; } catch (err) { /* 保存できなくても動く */ }

/** GAS から空き状況を読む。サイトの返事は GAS が1時間しまって使い、「読みなおす」（fresh）のときだけすぐ読み直す */
async function loadField(fresh = false) {
    field.loading = true;
    field.error = "";
    renderField();
    try {
        const result = await callApi("availability", { fresh });
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
    asOf.textContent = field.loading ? "読み込み中..."
        : p && p.asOf ? `${formatFieldTime(p.asOf)} 時点${p.stale ? "（サイトにつながらないので前の分）" : ""}` : "";
    const actions = document.createElement("div");
    actions.className = "toolbar-actions";
    if (p && p.pageUrl) actions.appendChild(createAnswerLink("予約サイト", p.pageUrl, "btn btn-small"));
    actions.appendChild(createButton("読みなおす", "btn btn-small", () => loadField(true), field.loading));
    head.append(asOf, actions);
    const children = [head];

    if (field.error) children.push(fieldNotice(field.error));
    else if (p && p.status !== "ok") children.push(fieldNotice(p.message || "空き状況を読めませんでした。"));
    else if (p) children.push(...renderFieldBody(p));
    root.replaceChildren(...children);
}

/** 空きのタブの知らせ（読めない・空きの日がない など） */
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
    note.textContent = `サイトに出ているのは ${last.label} まで。⚽ はこの施設での予定の時間。ほかの場所の予定は日の下に1行ずつ。`;
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

/** 色の見方（予約できる・空き状況のみ・うまっている） */
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
            head.textContent = `${monthNumberOf(month)}月`;
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
            date.textContent = shortFieldLabel(day.label);
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
    (p.elsewhere || []).filter(item => item.date === day.date).forEach(item => block.appendChild(createFieldElsewhere(item)));
    return block;
}

/** ほかの場所の予定（1件1行）：「ほかの場所　体育館 18:00〜20:00 練習」 */
function createFieldElsewhere(item) {
    const row = document.createElement("div");
    row.className = "field-elsewhere";
    const label = document.createElement("span");
    label.className = "field-elsewhere-label";
    label.textContent = "ほかの場所";
    const text = document.createElement("span");
    const time = item.end ? `${item.start}〜${item.end}` : item.start;
    text.textContent = [item.place || "場所なし", time, item.memo1].filter(Boolean).join(" ");
    row.append(label, text);
    return row;
}

/** 祝日は「11/23(月・祝)」→「11/23(祝)」（日付の列の幅に収め、①② をずらさない。色は赤のまま） */
function shortFieldLabel(label) {
    return String(label).replace(/\(.・祝\)$/, "(祝)");
}

/** 「2026-11-10T08:05:00+09:00」→「11/10 8:05」 */
function formatFieldTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${pad2(d.getMinutes())}`;
}
