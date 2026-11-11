// T-FONTE 予定シェア（index.html）の入口。LIFF の中で開く。
// GAS（doGet）から予定のカードを読んで見本を出し、「シェア」で LINE の友だち・グループに送る（shareTargetPicker）。
// 前に読んだ内容は端末に残し、次に開いたとき先に出す。

// LIFF_ID・GAS_URL・GROUP_LINK は js/config.js（先に読む）
const PREVIEW_CACHE_KEY = "t_fonte_reminder_preview_cache_v2";
const STATUS_TEXT = {
    noLiff: "LIFFなしのプレビュー表示です。",
    liffInitFailed: "LIFF初期化に失敗したため、プレビューのみ表示します。",
    outsideLine: "LINE外プレビュー中です。送信は LIFF から行ってください。",
    noShareApi: "このブラウザでは送信できないため、プレビューのみ表示します。",
    loading: "読み込み中...",
    reload: "再読み込みしてください。",
    refreshing: "前回プレビューを表示しつつ更新中..."
};

/** シェアするメッセージの長さの上限（LINE の決まり） */
const SHARE_LIMITS = { textChars: 5000, altTextChars: 1500, messages: 5 };

/** カードの下の「以上」「他○件」 */
const SUMMARY_NOTE_PATTERN = /^(他\d+件\b.*|以上)$/;

/** シェアのボタンのいつもの文字 */
const SHARE_BUTTON_LABEL = "LINEで送る";

const els = {
    loading: document.getElementById("loading"),
    messageList: document.getElementById("messageList"),
    shareBtn: document.getElementById("shareBtn"),
    reloadBtn: document.getElementById("reloadBtn"),
    statusText: document.getElementById("statusText"),
    statusSpinner: document.getElementById("statusSpinner"),
    summaryChip: document.getElementById("summaryChip"),
    debugPanel: document.getElementById("debugPanel"),
    debugPayload: document.getElementById("debugPayload"),
};

let previewMessages = [];
let shareTargetPickerMessages = [];
let canShareInLiff = false;

/** 画面を開いたとき・更新したとき：前の内容を先に出し、GAS から最新のカードを読んで出す */
async function main(forceRefresh = false) {
    setLoading();
    if (!forceRefresh) {
        renderCachedPreviewIfAvailable();
    }

    try {
        const [_, data] = await Promise.all([
            initializeLiffMode(),
            fetchShareData(forceRefresh)
        ]);
        const normalizedPayload = normalizePayload_(data);

        if (!normalizedPayload.previewMessages.length) {
            throw new Error("送信できるメッセージがありません。");
        }

        applyMessagePayload_(normalizedPayload);
        savePreviewCache(normalizedPayload);
        renderPreviewFromMessages(previewMessages);
        // 予定がない（カードがなく「まだありません」の文だけ）ときは、送るボタンを出さない
        setReady(canShareInLiff && shareTargetPickerMessages.some(message => message && message.type === "flex"));

    } catch (err) {
        console.error(err);
        setError("予定の読み込みに失敗しました。時間をおいてもう一度お試しください。");
    }
}

/** LIFF を準備し、LINE の中でシェア（shareTargetPicker）できるかを調べる */
async function initializeLiffMode() {
    canShareInLiff = false;

    if (!window.liff) {
        setStatus(STATUS_TEXT.noLiff);
        return;
    }

    try {
        await liff.init({ liffId: LIFF_ID });
    } catch (err) {
        setStatus(STATUS_TEXT.liffInitFailed);
        return;
    }

    if (!liff.isLoggedIn()) {
        setStatus(STATUS_TEXT.outsideLine);
        return;
    }

    if (!liff.isApiAvailable("shareTargetPicker")) {
        setStatus(STATUS_TEXT.noShareApi);
        return;
    }

    canShareInLiff = true;
}

/** GAS（doGet）から、見本とシェア用のカードを読む。forceRefresh ならシートから読み直させる */
async function fetchShareData(forceRefresh = false) {
    const requestUrl = forceRefresh
        ? `${GAS_URL}${GAS_URL.includes("?") ? "&" : "?"}refresh=1`
        : GAS_URL;

    const res = await fetch(requestUrl, {
        method: "GET",
        cache: "no-store",
    });

    if (!res.ok) {
        throw new Error(`GASへの接続に失敗しました。status=${res.status} url=${requestUrl}`);
    }

    return await res.json();
}

/** いろいろな形の返事から、メッセージの並びを取り出す */
function normalizeMessages(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.messages)) return data.messages;
    if (Array.isArray(data.data)) return data.data;
    if (data.type) return [data];
    return [];
}

/** 返事を「見本」と「シェア用」のメッセージにそろえる */
function normalizePayload_(data) {
    const normalizedPreviewMessages = normalizeMessages(
        data && Array.isArray(data.previewMessages) ? data.previewMessages : data
    ).map(cloneObject);
    const providedShareMessages = normalizeMessages(
        data && Array.isArray(data.shareMessages) ? data.shareMessages : []
    ).map(cloneObject);

    return {
        previewMessages: normalizedPreviewMessages,
        shareMessages: providedShareMessages.length
            ? providedShareMessages
            : buildShareTargetPickerMessages_(normalizedPreviewMessages)
    };
}

/** 中身の写しを作る（もとを書きかえないため） */
function cloneObject(value) {
    if (typeof structuredClone === "function") {
        return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value));
}

/** 前に読んだ内容が端末にあれば、先に出す */
function renderCachedPreviewIfAvailable() {
    const cachedPayload = loadPreviewCache();
    if (!cachedPayload.previewMessages.length) return;

    applyMessagePayload_(cachedPayload);
    renderPreviewFromMessages(previewMessages);
    els.loading.classList.add("hidden");
    els.messageList.classList.remove("hidden");
    els.reloadBtn.classList.remove("hidden");
    setFooterBusy(true);
    setStatus(STATUS_TEXT.refreshing, { loading: true });
}

/** 見本とシェア用のメッセージを覚える（シェア用がなければ見本から作る） */
function applyMessagePayload_(payload) {
    previewMessages = (payload.previewMessages || []).map(cloneObject);
    shareTargetPickerMessages = (payload.shareMessages || []).map(cloneObject);

    if (!shareTargetPickerMessages.length) {
        shareTargetPickerMessages = buildShareTargetPickerMessages_(previewMessages);
    }

    renderShareTargetPickerDebug_(shareTargetPickerMessages);
}

/** 読んだ内容を端末に残す（次に開いたとき先に出すため） */
function savePreviewCache(payload) {
    try {
        const cachePayload = {
            gasUrl: GAS_URL,
            savedAt: Date.now(),
            previewMessages: payload.previewMessages || [],
            shareMessages: payload.shareMessages || [],
        };
        localStorage.setItem(PREVIEW_CACHE_KEY, JSON.stringify(cachePayload));
    } catch (err) {
        console.warn("preview cache save skipped", err);
    }
}

/** 端末に残した内容を読む（なければ・GAS の URL が変わっていたら、空） */
function loadPreviewCache() {
    const empty = { previewMessages: [], shareMessages: [] };
    try {
        const raw = localStorage.getItem(PREVIEW_CACHE_KEY);
        if (!raw) return empty;

        const payload = JSON.parse(raw);
        if (!payload || payload.gasUrl !== GAS_URL) return empty;

        return normalizePayload_(payload);
    } catch (err) {
        console.warn("preview cache load skipped", err);
        return empty;
    }
}

/** メッセージの並びを、見本のカードとして画面に出す */
function renderPreviewFromMessages(messages) {
    els.messageList.innerHTML = "";
    const fragment = document.createDocumentFragment();

    messages.forEach((message, index) => {
        fragment.appendChild(createMessageCard(message, index));
    });

    els.messageList.appendChild(fragment);
    els.summaryChip.textContent = `${countPreviewUnits(messages)}か月分`;
    els.summaryChip.classList.remove("hidden");
}

/** メッセージ1つ分の見本（見出しと中身） */
function createMessageCard(message, index) {
    const card = document.createElement("section");
    card.className = "message-card";

    const head = document.createElement("div");
    head.className = "message-card-head";

    const title = document.createElement("h3");
    title.className = "message-card-title";
    title.textContent = createMessageTitle(message, index);

    const titleWrap = document.createElement("div");
    titleWrap.appendChild(title);

    const altText = getMessageAltText(message);
    if (altText && altText !== title.textContent) {
        const subtitle = document.createElement("p");
        subtitle.className = "message-card-subtitle";
        subtitle.textContent = `件名: ${altText}`;
        titleWrap.appendChild(subtitle);
    }

    const type = document.createElement("div");
    type.className = "message-card-type";
    type.textContent = message.type === "flex" ? "カード" : "テキスト";

    head.append(titleWrap, type);

    const body = document.createElement("div");
    body.className = "message-card-body";

    if (message.type === "flex") {
        body.appendChild(createFlexPreview(message));
    } else {
        body.appendChild(createTextPreview(message.text || ""));
    }

    card.append(head, body);
    return card;
}

/** 見本の見出し（カードなら通知文、文なら「テキスト」など） */
function createMessageTitle(message, index) {
    if (message.type === "flex") {
        const altText = getMessageAltText(message);
        if (altText) {
            return altText;
        }

        const firstBubble = getFirstBubble(message);
        const headerTitle = extractTexts(firstBubble?.header)[0] || "";
        return headerTitle || `Flexメッセージ ${index + 1}`;
    }

    const firstLine = String(message.text || "").split("\n").map(line => line.trim()).find(Boolean);
    return firstLine || `テキストメッセージ ${index + 1}`;
}

/** 文のメッセージの見本 */
function createTextPreview(text) {
    return createPreviewLines(text || "プレビューできるテキストがありません。");
}

/** 1行だけの見本（文・読めなかったカード） */
function createPreviewLines(text) {
    const wrapper = document.createElement("div");
    wrapper.className = "preview-lines";
    wrapper.appendChild(createTextElement("div", "preview-line", text));
    return wrapper;
}

/** カードのメッセージの見本（横に並べたもの・1枚のもの） */
function createFlexPreview(message) {
    if (message?.contents?.type === "carousel") {
        return createCarouselPreview(message);
    }

    if (message?.contents?.type === "bubble") {
        return createBubblePreview(message.contents, "single-bubble");
    }

    return createPreviewLines("Flex Messageを読み込みました。");
}

/** 横に並べたカードの見本 */
function createCarouselPreview(message) {
    const bubbles = getFlexBubbles(message);
    const wrapper = document.createElement("div");
    wrapper.className = "carousel-preview";

    bubbles.forEach(bubble => {
        wrapper.appendChild(createBubblePreview(bubble, "carousel-bubble"));
    });

    return wrapper;
}

/** カード1枚の見本（見出し・予定・ほか○件・リンク） */
function createBubblePreview(bubble, className) {
    const card = document.createElement("section");
    card.className = className;

    const header = createBubbleHeaderPreview(bubble);
    if (header) card.appendChild(header);

    const wrapper = document.createElement("div");
    wrapper.className = "preview-lines bubble-body";

    const scheduleItems = extractScheduleItems(bubble);
    if (scheduleItems.length) {
        const list = document.createElement("div");
        list.className = "schedule-list";
        scheduleItems.forEach(item => list.appendChild(createSchedulePreviewItem(item)));
        wrapper.appendChild(list);
    }

    const summaryNote = extractSummaryNote(bubble);
    if (summaryNote) wrapper.appendChild(createTextElement("div", "preview-line preview-note", summaryNote));

    if (!wrapper.childNodes.length) {
        wrapper.appendChild(createTextElement("div", "preview-line", "Flex Messageを読み込みました。"));
    }
    card.appendChild(wrapper);

    const footerLink = extractFooterLink(bubble);
    if (footerLink) {
        const link = createTextElement("a", "footer-link", footerLink.label);
        link.href = footerLink.uri;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        card.appendChild(link);
    }
    return card;
}

/** カードの見出し（題と、その下の一言。色はカードと同じ）。どちらもなければ null */
function createBubbleHeaderPreview(bubble) {
    const headerTexts = extractTexts(bubble?.header);
    const headerTitle = headerTexts[0] || "";
    const introText = headerTexts[1] || "";
    if (!headerTitle && !introText) return null;

    const header = document.createElement("div");
    header.className = "bubble-header";

    const headerColor = bubble?.header?.backgroundColor;
    if (typeof headerColor === "string" && /^#[0-9a-fA-F]{3,8}$/.test(headerColor)) {
        header.style.background = headerColor;
    }
    if (headerTitle) header.appendChild(createTextElement("div", "bubble-header-title", headerTitle));
    if (introText) header.appendChild(createTextElement("div", "bubble-header-sub", introText));
    return header;
}

/** 文字の入った部品を作る */
function createTextElement(tag, className, text) {
    const el = document.createElement(tag);
    el.className = className;
    el.textContent = text;
    return el;
}

/** カードのメッセージから、カードの並びを取り出す */
function getFlexBubbles(message) {
    if (message?.contents?.type === "carousel" && Array.isArray(message.contents.contents)) {
        return message.contents.contents;
    }

    if (message?.contents?.type === "bubble") {
        return [message.contents];
    }

    return [];
}

/** 最初のカード（なければ null） */
function getFirstBubble(message) {
    return getFlexBubbles(message)[0] || null;
}

/** 見本の予定1件（アイコン・内容・日時・天気・場所・もうすぐ） */
function createSchedulePreviewItem(item) {
    const article = document.createElement("article");
    article.className = `schedule-item${item.isNear ? " near" : ""}`;

    const layout = document.createElement("div");
    layout.className = "schedule-layout";
    layout.appendChild(createTextElement("div", "schedule-icon", item.iconText || "予"));

    const content = document.createElement("div");
    content.className = "schedule-content";

    const head = document.createElement("div");
    head.className = "schedule-head";
    head.appendChild(createTextElement("h4", "schedule-title", item.title || "予定"));
    if (item.isNear) head.appendChild(createTextElement("div", "near-chip", "もうすぐ"));
    content.appendChild(head);

    if (item.dateLine) content.appendChild(createScheduleDateLine(item));
    if (item.weatherText) content.appendChild(createTextElement("p", "schedule-weather", item.weatherText));
    if (item.placeLine) content.appendChild(createTextElement("p", "schedule-place", item.placeLine));

    layout.appendChild(content);
    article.appendChild(layout);
    return article;
}

/** 見本の予定の日時（曜日が読めたときは、土日に色を付ける） */
function createScheduleDateLine(item) {
    const meta = document.createElement("p");
    meta.className = "schedule-meta";
    if (item.dateMeta) {
        meta.append(
            document.createTextNode(item.dateMeta.prefix),
            createWeekdaySpan(item.dateMeta.weekday, item.dateMeta.weekendType),
            document.createTextNode(item.dateMeta.suffix)
        );
    } else {
        meta.textContent = item.dateLine;
    }
    return meta;
}

/** カードから、予定の並びを読み取る（hero になければ body から） */
function extractScheduleItems(bubble) {
    const heroContents = bubble?.hero?.contents;
    const contents = Array.isArray(heroContents) && heroContents.length ? heroContents : bubble?.body?.contents;
    if (!Array.isArray(contents)) return [];

    return contents
        .map(extractScheduleItemFromBox)
        .filter(Boolean);
}

/** カードの下の「以上」「他○件」を読み取る */
function extractSummaryNote(bubble) {
    const bodyTexts = extractTexts(bubble?.body);
    const bodyNote = bodyTexts.find(text => SUMMARY_NOTE_PATTERN.test(text));
    if (bodyNote) return bodyNote;

    const heroContents = bubble?.hero?.contents;
    if (!Array.isArray(heroContents)) return "";

    const fallbackNode = heroContents.find(item =>
        item?.type === "text" &&
        typeof item.text === "string" &&
        SUMMARY_NOTE_PATTERN.test(item.text)
    );

    return fallbackNode ? fallbackNode.text : "";
}

/** 予定1件の箱から、見本に出すものを読み取る */
function extractScheduleItemFromBox(box) {
    if (!box || box.type !== "box" || !Array.isArray(box.contents)) {
        return null;
    }

    const detailColumn = findDetailColumn_(box);
    const sourceBox = detailColumn || box;
    const textLines = Array.isArray(sourceBox.contents)
        ? sourceBox.contents.filter(item => item.type === "text")
        : [];

    const title = extractScheduleTitle_(sourceBox.contents || [], textLines) || "";
    const isNear = hasNearBadge_(box);
    const iconText = extractScheduleIconText_(box);
    const weatherText = extractWeatherText_(textLines);
    const dateMeta = extractDateMeta_(sourceBox.contents || []);
    const dateLine = dateMeta ? `${dateMeta.prefix}${dateMeta.weekday}${dateMeta.suffix}` : (textLines[0]?.text && textLines[0].text !== title ? textLines[0].text : textLines[1]?.text || "");
    const placeTextNode = [...textLines].reverse().find(item =>
        item?.text &&
        item.text !== title &&
        item.text !== dateLine &&
        item.text !== weatherText &&
        item.text !== "もうすぐ"
    );
    const placeLine = placeTextNode ? placeTextNode.text : "";

    if (!title && !dateLine && !placeLine) {
        return null;
    }

    return {
        title,
        isNear,
        iconText,
        weatherText,
        dateMeta,
        dateLine,
        placeLine
    };
}

/** 日時の行から、日付・曜日・時刻を読み取る */
function extractDateMeta_(contentItems) {
    if (!Array.isArray(contentItems)) return null;

    const dateRow = contentItems.find(item =>
        item?.type === "box" &&
        item?.layout === "horizontal" &&
        Array.isArray(item.contents) &&
        item.contents.length >= 3 &&
        item.contents.every(child => child?.type === "text")
    );
    if (!dateRow) return null;

    const parts = dateRow.contents.map(child => child.text || "");
    if (!parts[0] || !parts[1] || !parts[2]) return null;

    const weekendType = parts[1] === "日" ? "sun" : (parts[1] === "土" ? "sat" : "");

    return {
        prefix: parts[0],
        weekday: parts[1],
        suffix: parts.slice(2).join(""),
        weekendType
    };
}

/** 予定の内容を読み取る */
function extractScheduleTitle_(contentItems, textLines) {
    if (Array.isArray(textLines) && textLines.length) {
        return textLines[0].text || "";
    }

    if (!Array.isArray(contentItems)) return "";

    const titleRow = contentItems.find(item =>
        item?.type === "box" &&
        item?.layout === "horizontal" &&
        Array.isArray(item.contents) &&
        item.contents.some(child => child?.type === "text" && child.flex === 1 && child.text)
    );
    if (!titleRow) return "";

    const titleNode = titleRow.contents.find(item => item.type === "text" && item.flex === 1 && item.text);
    return titleNode ? titleNode.text : "";
}

/** 予定の箱から、内容・日時・場所の列を探す */
function findDetailColumn_(node) {
    if (!node || !Array.isArray(node.contents)) return null;

    const directMatch = node.contents.find(item =>
        item?.type === "box" &&
        item?.layout === "vertical" &&
        item?.flex === 1
    );
    if (directMatch) return directMatch;

    for (const child of node.contents) {
        const nestedMatch = findDetailColumn_(child);
        if (nestedMatch) return nestedMatch;
    }

    return null;
}

/** 「もうすぐ」の印があるか */
function hasNearBadge_(box) {
    if (!Array.isArray(box?.contents)) return false;

    return box.contents.some(item => {
        if (item?.type === "text" && item.text === "もうすぐ") {
            return true;
        }

        return item?.type === "box" &&
            Array.isArray(item.contents) &&
            item.contents.some(child => child?.type === "text" && child.text === "もうすぐ");
    });
}

/** 予定のアイコンの文字を読み取る */
function extractScheduleIconText_(box) {
    // GAS の FLEX_CONFIG.iconBackgroundColor（予定の丸いアイコン）
    const iconContainer = findBoxByBackgroundColor_(box, "#E6EEF9");
    const iconNode = Array.isArray(iconContainer?.contents)
        ? iconContainer.contents.find(child => child?.type === "text" && child.text)
        : null;
    return iconNode ? iconNode.text : derivePreviewIconText_(extractTexts(box)[0] || "");
}

/** 内容の1文字目をアイコンにする（なければ「予」） */
function derivePreviewIconText_(title) {
    return Array.from(String(title || "").trim())[0] || "予";
}

/** 「予報: 」の行を読み取る（前のカードの「天気: 」も） */
function extractWeatherText_(textLines) {
    if (!Array.isArray(textLines)) return "";

    const weatherNode = textLines.find(item =>
        typeof item?.text === "string" && (item.text.startsWith("予報: ") || item.text.startsWith("天気: "))
    );

    return weatherNode ? weatherNode.text : "";
}

/** 曜日の文字（土日は色を変える） */
function createWeekdaySpan(text, weekendType) {
    const span = document.createElement("span");
    span.textContent = text;

    if (weekendType) {
        span.className = `schedule-meta-weekday ${weekendType}`;
    }

    return span;
}

/** 決まった背景色の箱を探す */
function findBoxByBackgroundColor_(node, backgroundColor) {
    if (!node || !Array.isArray(node.contents)) return null;

    const directMatch = node.contents.find(item =>
        item?.type === "box" &&
        item?.backgroundColor === backgroundColor &&
        Array.isArray(item.contents) &&
        item.contents.some(child => child?.type === "text" && child.text)
    );
    if (directMatch) return directMatch;

    for (const child of node.contents) {
        const nestedMatch = findBoxByBackgroundColor_(child, backgroundColor);
        if (nestedMatch) return nestedMatch;
    }

    return null;
}

/** メッセージの通知文（なければ空文字） */
function getMessageAltText(message) {
    return typeof message?.altText === "string" ? message.altText : "";
}

/** カードの下のリンクのボタン（文字と URL） */
function extractFooterLink(bubble) {
    const contents = bubble?.footer?.contents;
    if (!Array.isArray(contents)) return null;

    const button = contents.find(item => item.type === "button" && item.action?.type === "uri");
    return button ? { label: button.action.label || "リンクを開く", uri: button.action.uri } : null;
}

/** 箱の中の文字をすべて集める */
function extractTexts(node) {
    const texts = [];
    collectTexts(node, texts);
    return texts;
}

/** 箱の中をたどって、文字を result に足す */
function collectTexts(node, result) {
    if (!node || typeof node !== "object") return;

    if (node.type === "text" && node.text) {
        result.push(node.text);
    }

    if (Array.isArray(node.contents)) {
        node.contents.forEach(child => collectTexts(child, result));
    }

    ["header", "hero", "body", "footer"].forEach(key => {
        if (node[key]) {
            collectTexts(node[key], result);
        }
    });
}

/** 見本の数（カードは枚数、文は1つ） */
function countPreviewUnits(messages) {
    return messages.reduce((count, message) => {
        if (message?.type !== "flex") {
            return count + 1;
        }

        const bubbleCount = getFlexBubbles(message).length;
        return count + (bubbleCount || 1);
    }, 0);
}

/** シェア用のメッセージを作る（LINE の決まりに合わせ、5つまで） */
function buildShareTargetPickerMessages_(messages) {
    return (Array.isArray(messages) ? messages : [])
        .flatMap(message => normalizeShareTargetPickerMessages_(message))
        .filter(Boolean)
        .slice(0, SHARE_LIMITS.messages);
}

/** シェアするメッセージの中身を、確かめ用の欄に出す */
function renderShareTargetPickerDebug_(messages) {
    if (!els.debugPanel || !els.debugPayload) return;

    const payload = Array.isArray(messages) ? messages : [];
    els.debugPayload.textContent = JSON.stringify(payload, null, 2);
    els.debugPanel.classList.toggle("hidden", !payload.length);

    if (payload.length) {
        console.log("preparedShareTargetPickerMessages", payload);
    }
}

/** メッセージ1つを、シェアできる形にする（できなければ空の並び） */
function normalizeShareTargetPickerMessages_(message) {
    const sanitizedMessage = sanitizeMessageForShareTargetPicker_(message);
    return sanitizedMessage ? [sanitizedMessage] : [];
}

/** シェアできない項目（送り主・クイックリプライなど）を外す。もとのメッセージは書きかえない */
function sanitizeMessageForShareTargetPicker_(message) {
    if (!message || typeof message !== "object") {
        return null;
    }

    const baseMessage = {
        type: message.type
    };

    if (message.type === "flex") {
        let contents = cloneObject(message.contents);

        if (contents?.type === "carousel" && Array.isArray(contents.contents)) {
            contents.contents = getShareableCarouselBubbles_(contents.contents);
        }

        contents = sanitizeNodeForShareTargetPicker_(contents, {
            insideFooter: false
        });
        if (!contents) {
            return null;
        }

        if (contents?.type === "carousel" && Array.isArray(contents.contents) && !contents.contents.length) {
            return null;
        }

        baseMessage.altText = trimShareAltText_(message.altText || extractTexts(contents)[0] || "活動予定");
        baseMessage.contents = contents;
        return baseMessage;
    }

    if (message.type === "text") {
        const text = String(message.text || "").trim();
        return text ? { type: "text", text: text.slice(0, SHARE_LIMITS.textChars) } : null;
    }

    return null;
}

/** 通知文を上限の長さまでにする */
function trimShareAltText_(text) {
    return String(text || "").slice(0, SHARE_LIMITS.altTextChars);
}

/** シェアするカード（先頭の送信ガイドは除く） */
function getShareableCarouselBubbles_(bubbles) {
    if (!Array.isArray(bubbles) || !bubbles.length) {
        return [];
    }

    // 送信ガイドだけを外す（ガイドのない並びから、先頭の月のカードを落とさない）。全部ガイドなら、そのまま
    const withoutGuide = bubbles.filter(bubble => !isAutoReminderGuideBubble_(bubble));
    return withoutGuide.length ? withoutGuide : bubbles.slice();
}

/** 「リマインド送信ガイド」のカードか */
function isAutoReminderGuideBubble_(bubble) {
    if (!bubble || typeof bubble !== "object") return false;
    return extractTexts(bubble.header).includes("リマインド送信ガイド");
}

/** カードの中から、シェアできないボタンなどを外す */
function sanitizeNodeForShareTargetPicker_(node, context = {}) {
    if (!node || typeof node !== "object") return null;
    const { insideFooter = false } = context;

    if (Array.isArray(node.contents)) {
        node.contents = node.contents
            .map(child => sanitizeNodeForShareTargetPicker_(child, { insideFooter }))
            .filter(Boolean);
    }

    ["header", "hero", "body", "footer", "contents"].forEach(key => {
        if (node[key]) {
            const sanitizedChild = sanitizeNodeForShareTargetPicker_(node[key], {
                insideFooter: insideFooter || key === "footer"
            });
            if (sanitizedChild) {
                node[key] = sanitizedChild;
            } else {
                delete node[key];
            }
        }
    });

    if (node.action) {
        if (node.type === "button") {
            if (!insideFooter || node.action.type !== "uri") {
                return null;
            }
        } else {
            delete node.action;
        }
    }

    if (node.type === "box" && Array.isArray(node.contents) && !node.contents.length) {
        return null;
    }

    return node;
}

/** 「シェア」を押したとき：送り先を選んでもらい、カードを送る */
async function handleShare() {
    try {
        els.shareBtn.disabled = true;
        els.shareBtn.textContent = "送信先を選択中...";
        setStatus("送信先を選択中...");

        if (!Array.isArray(shareTargetPickerMessages) || !shareTargetPickerMessages.length) {
            throw new Error("送信用メッセージを作成できませんでした。");
        }

        console.log("shareTargetPickerMessages", shareTargetPickerMessages);

        const result = await liff.shareTargetPicker(shareTargetPickerMessages, {
            isMultiple: true,
        });

        if (result && result.status === "success") {
            els.shareBtn.textContent = "送信しました";
            setStatus(`${countPreviewUnits(shareTargetPickerMessages)}か月分の予定を送信しました。グループに移動します...`);

            setTimeout(() => {
                window.location.href = GROUP_LINK;
            }, 1200);
        } else {
            resetShareButton();
            setStatus("送信をキャンセルしました。");
        }

    } catch (err) {
        console.error(err);
        resetShareButton();
        setStatus("送信に失敗しました。時間をおいてもう一度お試しください。");
    }
}

/** シェアのボタンを、押せるいつもの文字にもどす */
function resetShareButton() {
    els.shareBtn.disabled = false;
    els.shareBtn.textContent = SHARE_BUTTON_LABEL;
}

/** 下の知らせの文字を出す（loading なら回る印も） */
function setStatus(message, options = {}) {
    const { loading = false } = options;
    els.statusText.textContent = message;
    els.statusSpinner.classList.toggle("hidden", !loading);
}

/** 下のボタンを、押せない・押せるにする */
function setFooterBusy(isBusy) {
    [els.shareBtn, els.reloadBtn].forEach(button => {
        if (button && !button.classList.contains("hidden")) {
            button.disabled = isBusy;
        }
    });
}

/** 読みこみ中の表示にする */
function setLoading() {
    els.loading.classList.remove("hidden");
    els.messageList.classList.add("hidden");
    els.messageList.innerHTML = "";
    els.summaryChip.classList.add("hidden");
    els.shareBtn.classList.add("hidden");
    els.reloadBtn.classList.add("hidden");
    setFooterBusy(true);
    setStatus(STATUS_TEXT.loading, { loading: true });
}

/** 読めたときの表示にする（シェアできるときだけシェアのボタンを出す） */
function setReady(shareEnabled) {
    els.loading.classList.add("hidden");
    els.messageList.classList.remove("hidden");
    els.reloadBtn.classList.remove("hidden");
    setFooterBusy(false);

    if (shareEnabled) {
        els.shareBtn.classList.remove("hidden");
        resetShareButton();
        setStatus(`${countPreviewUnits(shareTargetPickerMessages)}か月分の送信準備ができました。`);
        return;
    }

    els.shareBtn.classList.add("hidden");
    if (!els.statusText.textContent || els.statusText.textContent === STATUS_TEXT.loading || els.statusText.textContent === STATUS_TEXT.refreshing) {
        setStatus(`${countPreviewUnits(previewMessages)}か月分をプレビュー表示しています。`);
    }
}

/** 読めなかったときの表示にする */
function setError(message) {
    els.loading.classList.add("hidden");
    els.messageList.classList.remove("hidden");
    els.messageList.innerHTML = "";
    els.summaryChip.classList.add("hidden");
    els.shareBtn.classList.add("hidden");
    els.reloadBtn.classList.remove("hidden");
    setFooterBusy(false);

    const errorCard = document.createElement("section");
    errorCard.className = "message-card";

    const body = document.createElement("div");
    body.className = "message-card-body";

    const line = document.createElement("div");
    line.className = "preview-line";
    line.textContent = `🚨 読み込みに失敗しました。\n\n${message || "不明なエラー"}`;

    body.appendChild(line);
    errorCard.appendChild(body);
    els.messageList.appendChild(errorCard);

    setStatus(STATUS_TEXT.reload);
}

els.shareBtn.addEventListener("click", handleShare);
els.reloadBtn.addEventListener("click", () => main(true));

main();
