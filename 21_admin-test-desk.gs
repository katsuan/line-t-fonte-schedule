// ==========[ 管理者のテストの窓口：#テスト（#test） ]==========
//
// 管理者（Script Property `ADMIN_USER_IDS`。管理ページと同じ決め方）だけが、トークで「#テスト」と送ると 🧪 テストのカードが返る。
// ふつうの人には、知らない言葉と同じ（何も返さない）。
// - クイックリプライを押すだけで、返事・カードの見本と自己点検を試せる
// - 見本の中身はためしのデータ。本物の予定・シート・カレンダー・登録待ちには書かない（DebugLog はいつもどおり残る）
// - 返事（reply）だけで返す。push の自動リマインドは、見本を reply で見せる
// 20_text-router.gs から呼ばれる。自己点検は 00_setup.gs の runSelfCheck も使う

/** #テスト（#test）と、そのあとに書く言葉 */
const ADMIN_TEST_TRIGGER_PATTERN_ = /^#(テスト|test)(?:[ \t　]+(.*))?$/i;

/** 見本の返事の送り主 */
const ADMIN_TEST_SENDER_ = createSender("🧪 T-FONTE テスト", ICONS.Auto);

/** #テスト のあとに書く言葉と、試せるもの。並びはクイックリプライの並び */
const ADMIN_TEST_ITEMS_ = [
  { key: "一覧", label: "自動リマインド", detail: "管理者に届く通知（送信ガイド＋月ごとのカード）" },
  { key: "共有", label: "予定カード", detail: "#リマインド・#今後の予定・リッチに送る のカード" },
  { key: "登録", label: "予定登録の確認", detail: "#予定登録 の確認の一覧カード" },
  { key: "登録済み", label: "登録したあと", detail: "#予定確定 のあとの返事" },
  { key: "古いカード", label: "古いカードを押した", detail: "済んだ・古い・ほかの人・時間切れの確認カードが押されたときの返事" },
  { key: "文", label: "文の返事", detail: "まちがい・取り消し・予定がないときの文" },
  { key: "断られ", label: "カードが断られた", detail: "カードを送れなかったときの文の返事" },
  { key: "点検", label: "自己点検", detail: "設定・シート・カレンダー・通知のようす" }
];

/** #テスト（#test）か */
function isAdminTestTriggerText_(text) {
  return ADMIN_TEST_TRIGGER_PATTERN_.test(text);
}

/** 管理者でなければ undefined（知らない言葉と同じ）。管理者なら、選んだ見本か、テストのカード */
function createAdminTestMessages_(text, event) {
  const userId = event && event.source && event.source.userId;
  if (!userId || !isAdminUserId_(userId)) return undefined;

  const match = ADMIN_TEST_TRIGGER_PATTERN_.exec(text) || [];
  const key = String(match[2] || "").trim();
  const builders = {
    "一覧": buildAdminTestAutoReminder_,
    "共有": buildAdminTestShareCards_,
    "登録": buildAdminTestRegistration_,
    "登録済み": buildAdminTestRegistered_,
    "古いカード": buildAdminTestStaleDraft_,
    "文": buildAdminTestTexts_,
    "断られ": buildAdminTestCardFallback_,
    "点検": buildAdminTestSelfCheck_
  };
  const messages = builders[key] ? builders[key]() : [createAdminTestMenu_()];
  return attachAdminTestMenuQuickReply_(markAdminTestMessages_(messages));
}

// ---------- テストのカード ----------

/** 🧪 テストのカード（試せるものの一覧） */
function createAdminTestMenu_() {
  const rows = ADMIN_TEST_ITEMS_.map(function (item) {
    return {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: `${item.label}（#テスト ${item.key}）`, size: "sm", weight: "bold", color: FLEX_CONFIG.textPrimaryColor, wrap: true },
        { type: "text", text: item.detail, size: "xs", color: FLEX_CONFIG.textSecondaryColor, wrap: true }
      ]
    };
  });
  rows.push({
    type: "text",
    text: "下のクイックリプライか、「#テスト 登録」のように送ると試せます。見本の中身はためしのデータで、本物の予定・シート・カレンダーには書きません。",
    size: "xs",
    color: FLEX_CONFIG.summaryTextColor,
    wrap: true,
    margin: "md"
  });

  return {
    type: "flex",
    altText: "🧪 テストの窓口：返事の見本と自己点検",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: FLEX_CONFIG.headerBackgroundColor,
        paddingAll: FLEX_CONFIG.headerPadding,
        contents: [
          { type: "text", text: "管理者だけ", size: "xs", color: "#ffffff" },
          { type: "text", text: "テスト", size: "lg", weight: "bold", color: "#ffffff" }
        ]
      },
      body: { type: "box", layout: "vertical", spacing: "md", paddingAll: FLEX_CONFIG.cardPadding, contents: rows }
    }
  };
}

/** 最後のメッセージのクイックリプライを、テストの項目にする（見本のボタンから本物の操作に進まないように） */
function attachAdminTestMenuQuickReply_(messages) {
  if (!messages.length) return messages;
  const items = ADMIN_TEST_ITEMS_.map(function (item) {
    return LINE_func.createQuickReply(item.label, { text: `#テスト ${item.key}` });
  });
  items.push(LINE_func.createQuickReply("テストの一覧", { text: "#テスト" }));
  messages[messages.length - 1].quickReply = { items: items };
  return messages;
}

/** 見本だとわかるよう、文・altText・カードの見出しの先頭に 🧪 を付け、送り主をテストにする */
function markAdminTestMessages_(messages) {
  return messages.map(function (source) {
    const message = JSON.parse(JSON.stringify(source));
    message.sender = ADMIN_TEST_SENDER_;
    delete message.quickReply;
    if (message.type === "text") message.text = prefixAdminTestMark_(message.text);
    if (message.type === "flex") {
      message.altText = trimAltText_(prefixAdminTestMark_(message.altText));
      const bubbles = message.contents.type === "carousel" ? message.contents.contents : [message.contents];
      bubbles.forEach(markAdminTestBubbleHeader_);
    }
    return message;
  });
}

/** 文の先頭に 🧪 をつける（すでにあればそのまま） */
function prefixAdminTestMark_(text) {
  const value = String(text || "");
  return value.indexOf("🧪") === 0 ? value : `🧪 ${value}`;
}

/** カードの見出しの先頭に 🧪 をつける */
function markAdminTestBubbleHeader_(bubble) {
  const header = bubble && bubble.header;
  const texts = header && Array.isArray(header.contents)
    ? header.contents.filter(function (node) { return node.type === "text"; })
    : [];
  if (texts.length) texts[texts.length - 1].text = prefixAdminTestMark_(texts[texts.length - 1].text);
}

// ---------- 見本（ためしのデータ） ----------

/** 今日から見て、近い予定・来月の予定などが入るように作る。シートは読まない */
function buildAdminTestRecords_() {
  const today = startOfDay_(new Date());
  const make = function (days, start, end, place, memo1, memo2, link) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
    const at = function (time) {
      const parts = time.split(":").map(Number);
      return new Date(date.getFullYear(), date.getMonth(), date.getDate(), parts[0], parts[1]);
    };
    const startDate = at(start);
    const endDate = at(end);
    return {
      date: startDate,
      endDate: endDate,
      start: startDate,
      end: endDate,
      formatted: {
        date: _formatDate_(startDate, FORMAT.Date),
        start: _formatDate_(startDate, FORMAT.Time),
        end: _formatDate_(endDate, FORMAT.Time)
      },
      place: place,
      memo1: memo1,
      memo2: memo2 || "",
      link: link || ""
    };
  };

  return [
    make(1, "15:00", "17:00", "灘崎総合公園", "⚽フットサル", "①", "https://example.com/test-form"),
    make(3, "19:00", "21:00", "ニッショク岡山", "⚽フットサル", "", ""),
    make(12, "09:00", "16:00", "テスト体育館", "🏆フットサル大会", "", ""),
    make(20, "10:00", "12:00", "テスト公園", "🤝交流イベント", "", ""),
    make(35, "15:00", "17:00", "灘崎総合公園", "⚽フットサル", "②", "https://example.com/test-form-next")
  ];
}

/** 見本：管理者への通知（送信ガイド＋月ごとのカード） */
function buildAdminTestAutoReminder_() {
  const records = buildAdminTestRecords_();
  return buildReminderFlexMessages_(records, {
    forceRefresh: false,
    includeGuideBubble: true,
    reminderText: buildReminderTextMessageTextFromRecords_(records)
  });
}

/** 見本：#リマインド の予定カード */
function buildAdminTestShareCards_() {
  return buildReminderFlexMessages_(buildAdminTestRecords_(), { forceRefresh: false });
}

/** 見本：#予定登録 の確認カード（ボタンは見本の返事へ） */
function buildAdminTestRegistration_() {
  const records = buildAdminTestRecords_().slice(0, 3).map(function (record) {
    return { date: startOfDay_(record.date), start: record.start, end: record.end, place: record.place, memo1: record.memo1, memo2: record.memo2, link: record.link };
  });
  records[1].end = null;
  return [createScheduleConfirmFlexMessage_(records, {
    link: "https://example.com/test-form",
    autoFilledCount: 1,
    errors: [{ lineNumber: 5, raw: "2/30 10:00〜12:00 公園 練習" }],
    // 見本のボタンは本物の登録に進まず、見本の返事を出す
    actions: { confirmText: "#テスト 登録済み", cancelText: "#テスト 古いカード" }
  })];
}

/** 見本：#予定確定 のあとの返事（シートには書かない） */
function buildAdminTestRegistered_() {
  return [{ type: "text", text: "✅ 3件登録しました。（見本なので、シートには書いていません）" }]
    .concat(buildAdminTestAutoReminder_());
}

/** 確認カードが、済んだあと・何日もあと・ほかの人に押されたときの返事（5通） */
function buildAdminTestStaleDraft_() {
  return ["registered", "cancelled", "old", "expired", "otherUser"].map(function (kind) {
    return { type: "text", text: SCHEDULE_DRAFT_REPLY_TEXTS_[kind] };
  });
}

/** 文のまま返している返事の見本（5通まで。LINE の返事は1回に5通まで） */
function buildAdminTestTexts_() {
  return [
    { type: "text", text: `⚠️ 読み取れる予定がありませんでした。\n　2行目: 「2/30 10:00〜12:00 公園 練習」\n\n${SCHEDULE_REGISTRATION_EXAMPLE_}` },
    { type: "text", text: SCHEDULE_DRAFT_REPLY_TEXTS_.none },
    { type: "text", text: "キャンセルしました。" },
    { type: "text", text: SHEET_ERROR_TEXT + "\n（これからの予定が1件もないときの返事）" },
    { type: "text", text: "⚠️ 内部エラーが発生しました。\n少し待ってから、もう一度送ってください。" }
  ];
}

/** カードを送れなかったとき（親のボットが文で返しなおすとき）に使える文：これまでのテキストの文面 */
function buildAdminTestCardFallback_() {
  return [{
    type: "text",
    text: `カードを送れなかったときは、次の文で返します。\n\n${buildReminderTextMessageTextFromRecords_(buildAdminTestRecords_())}`
  }];
}

// ---------- 自己点検（読むだけ。書かない） ----------

/** 自己点検のカード（設定・シート・カレンダー・通知のようす） */
function buildAdminTestSelfCheck_() {
  const checks = collectAdminSelfChecks_();
  const rows = checks.map(function (check) {
    const mark = selfCheckMark_(check.level);
    return {
      type: "box",
      layout: "horizontal",
      spacing: "sm",
      contents: [
        { type: "text", text: mark, size: "sm", flex: 0 },
        { type: "text", text: check.label, size: "sm", weight: "bold", color: FLEX_CONFIG.textPrimaryColor, flex: 3, wrap: true },
        { type: "text", text: check.value, size: "sm", color: FLEX_CONFIG.textSecondaryColor, flex: 5, wrap: true }
      ]
    };
  });
  const problems = checks.filter(function (check) { return check.level !== "ok"; }).length;

  return [{
    type: "flex",
    altText: problems ? `自己点検：見てほしいところが${problems}つあります` : "自己点検：すべてだいじょうぶです",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: FLEX_CONFIG.headerBackgroundColor,
        paddingAll: FLEX_CONFIG.headerPadding,
        contents: [
          { type: "text", text: _formatDate_(new Date(), "M/d HH:mm"), size: "xs", color: "#ffffff" },
          { type: "text", text: problems ? `自己点検（${problems}件 見てね）` : "自己点検（だいじょうぶ）", size: "lg", weight: "bold", color: "#ffffff", wrap: true }
        ]
      },
      body: { type: "box", layout: "vertical", spacing: "sm", paddingAll: FLEX_CONFIG.cardPadding, contents: rows }
    }
  }];
}

/** 自己点検の印（ok: ✅・warn: ⚠️・ng: ❌） */
function selfCheckMark_(level) {
  return level === "ok" ? "✅" : level === "warn" ? "⚠️" : "❌";
}

/** 1つ読めなくても、ほかの点検は続ける */
function collectAdminSelfChecks_() {
  const props = PropertiesService.getScriptProperties();
  const check = function (label, read) {
    try {
      const result = read();
      return { label: label, level: result.level || "ok", value: String(result.value) };
    } catch (err) {
      return { label: label, level: "ng", value: "読めませんでした" };
    }
  };

  return [
    check("Plan シート", function () {
      if (!SHEETS.Plan) return { level: "ng", value: "見つかりません" };
      return { value: `予定 ${listPlanRecords_().length}件` };
    }),
    check("これからの予定", function () {
      const upcoming = readUpcomingRecordsFromSheet_();
      if (!upcoming.length) return { level: "warn", value: "0件（#今後の予定 は「予定がない」と返します）" };
      return { value: `${upcoming.length}件（次: ${upcoming[0].formatted.date} ${upcoming[0].formatted.start}）` };
    }),
    check("通知する日数（Setting!B2）", function () {
      return SETTING.RemindNum >= 0
        ? { value: `${SETTING.RemindNum}日後まで` }
        : { level: "ng", value: "数字になっていません（通知しません）" };
    }),
    check("次に通知する予定", function () {
      const targets = getReminderTargetRecords_(readUpcomingRecordsFromSheet_(), new Date());
      return { value: targets.length ? buildAutoReminderSenderNameFromRecords_(targets) : "なし（通知済みか、期間に予定がない）" };
    }),
    check("管理者", function () {
      const count = (props.getProperty(ADMIN_API_CONFIG.adminUserIdsProperty) || "").split(",").filter(function (id) { return id.trim(); }).length;
      return count ? { value: `${count}人` } : { level: "ng", value: "ADMIN_USER_IDS が空です" };
    }),
    check("Google カレンダー同期", function () {
      const calendarId = getCalendarSyncId_();
      if (!calendarId) return { level: "warn", value: "CALENDAR_ID が未設定（同期しません）" };
      const status = props.getProperty(CALENDAR_SYNC_CONFIG.statusProperty) || "まだ同期していません";
      return { level: isDedicatedCalendarId_(calendarId) ? "ok" : "warn", value: isDedicatedCalendarId_(calendarId) ? status : `${status}（個人のカレンダーなので登録リンクは出しません）` };
    }),
    check("トリガー", function () {
      const handlers = ScriptApp.getProjectTriggers().map(function (trigger) { return trigger.getHandlerFunction(); });
      const missing = ["onPlanSheetChanged", "syncPlansToCalendarJob"].filter(function (name) { return handlers.indexOf(name) === -1; });
      return missing.length
        ? { level: "warn", value: `${missing.join("・")} が見つかりません（このプロジェクトの GAS エディタで作ります。親から呼ぶと親のトリガーを見ます）` }
        : { value: "変更の検知・1日1回の同期 あり" };
    })
  ];
}
