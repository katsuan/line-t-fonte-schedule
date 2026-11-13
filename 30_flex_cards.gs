// ==========[ 予定のカード（Flex Message） ]==========
//
// 月ごとの予定カード・通知カードの先頭の送信ガイド・画面（リッチに送る）に返す中身を作る。
// 入口（01_ の doGet・createAutoReminderMessages）・トークの返事（20_・13_）・#テスト（21_）から使う

/** 予定カードの色・大きさ・1枚に並べる数 */
const FLEX_CONFIG = {
  maxBubblesPerCarousel: 12,
  maxVisibleRecordsPerMonth: 4,
  nearTermDays: 5,
  headerBackgroundColor: "#4284F3",
  recordBackgroundColor: "#F6F8FB",
  iconBackgroundColor: "#E6EEF9",
  badgeBackgroundColor: "#FFE2BF",
  summaryTextColor: "#93A1B4",
  badgeTextColor: "#A54B00",
  weatherTextColor: "#3566A8",
  textPrimaryColor: "#222222",
  textSecondaryColor: "#555555",
  sundayTextColor: "#D94B45",
  saturdayTextColor: "#3B82F6",
  iconTextColor: "#1F2937",
  headerPadding: "16px",
  cardPadding: "12px",
  cardCornerRadius: "12px",
  iconSize: "52px",
  iconCornerRadius: "999px",
  badgeWidth: "70px",
  badgeHeight: "22px",
  badgeCornerRadius: "100px",
  badgePaddingAll: "2px",
  badgePaddingHorizontal: "7px",
  badgeOffset: "12px",
  // 月の共通リンクとちがうリンク・リンクなしの予定の1行（ピル）。出すのは上からこの数まで
  linkPillColor: "#4284F3",
  linkPillTextColor: "#FFFFFF",
  linkPillOffColor: "#E5E7EB",
  linkPillOffTextColor: "#9CA3AF",
  linkPillLabel: "📝 回答する",
  linkPillOffLabel: "リンクなし"
};

/** カードの通知文（altText）の既定の見出しと、長さの上限 */
const ALT_TEXT_CONFIG = {
  defaultTitle: "🗓️ 活動日リマインド",
  maxChars: 1500
};

/** コピーのボタンの文字の上限（LINE の上限） */
const CLIPBOARD_TEXT_MAX_CHARS = 1000;

/** 通知カードの先頭の「リマインド送信ガイド」の文字と色 */
const AUTO_REMINDER_GUIDE_CONFIG = {
  headerTitle: "リマインド送信ガイド",
  bodyLabel: "これまでのテキスト文面",
  copyButtonLabel: "コピー", // 見出しの右の小さなピル
  adminButtonLabel: "予定を管理",
  groupButtonLabel: "グループへ",
  richButtonLabel: "リッチに送る",
  cardBackgroundColor: "#FFF9EC",
  bodyBackgroundColor: "#FFFFFF",
  bodyTextColor: "#4B5563",
  guideAccentColor: "#B7791F"
};

// LINE のカードの URL は 1000 字まで（こえるとカードごと断られる）
const LINE_URI_MAX_CHARS_ = 1000;

// ---------- 返事にするカード ----------

/** 管理者への通知・#今後の予定 の返事：送信ガイド＋月ごとの予定カード */
function createAutoReminderFlexMessages_() {
  const records = extractUpcomingRecordsWithDateObjects();
  const reminderText = buildReminderTextMessageTextFromRecords_(records);
  const messages = buildReminderFlexMessages_(records, {
    forceRefresh: false,
    includeGuideBubble: true,
    reminderText
  });
  return attachReminderQuickReply_(messages);
}

/** #リマインド の返事：月ごとの予定カード（クイックリプライつき） */
function createShareFlexMessages_(forceRefresh) {
  const records = extractUpcomingRecordsWithDateObjects(forceRefresh);
  const messages = buildReminderFlexMessages_(records, {
    forceRefresh: !!forceRefresh
  });
  return attachReminderQuickReply_(messages);
}

/** 画面（リッチに送る）に返す中身：見本とシェア用のカード（送信ガイドは作ってから外す。管理者向けのため） */
function createLiffPayload_(forceRefresh) {
  const records = extractUpcomingRecordsWithDateObjects(forceRefresh);
  const reminderText = buildReminderTextMessageTextFromRecords_(records);
  const viewModel = buildReminderFlexViewModel_(records, {
    forceRefresh: !!forceRefresh,
    includeGuideBubble: true,
    reminderText: reminderText
  });

  if (viewModel.errorMessage) {
    return {
      previewMessages: [viewModel.errorMessage],
      shareMessages: [viewModel.errorMessage]
    };
  }

  const previewBubbleEntries = getShareablePreviewBubbleEntries_(viewModel.bubbleEntries);
  const shareMessages = buildCarouselMessages_(previewBubbleEntries);

  return {
    previewMessages: shareMessages,
    shareMessages: shareMessages
  };
}

/** 送信ガイド（先頭のカード）を除いたカード。カードが1枚だけなら、そのまま使う */
function getShareablePreviewBubbleEntries_(bubbleEntries) {
  if (!Array.isArray(bubbleEntries)) {
    return [];
  }

  return bubbleEntries.length <= 1 ? bubbleEntries.slice() : bubbleEntries.slice(1);
}

/** 予定から、横に並べたカードのメッセージを作る（予定がなければ文のお知らせ） */
function buildReminderFlexMessages_(records, options) {
  const viewModel = buildReminderFlexViewModel_(records, options);

  if (viewModel.errorMessage) {
    return [viewModel.errorMessage];
  }

  return buildCarouselMessages_(viewModel.bubbleEntries);
}

/** カード（と近い予定の日付）を作る。予定がなければ errorMessage を返す */
function buildReminderFlexViewModel_(records, options) {
  const { forceRefresh, includeGuideBubble, reminderText, noWeather } = options || {};
  const now = new Date();

  if (!records.length) {
    return { errorMessage: createSheetErrorMessage_() };
  }

  // noWeather … #テスト の見本など、外に問い合わせないとき
  const nearTermWeatherSummaryMap = noWeather ? {} : getNearTermWeatherSummaryMap_(
    records,
    now,
    FLEX_CONFIG.nearTermDays,
    !!forceRefresh
  );
  const groups = buildMonthlyFlexGroups_(records, now, nearTermWeatherSummaryMap);

  if (!groups.length) {
    return { errorMessage: createSheetErrorMessage_() };
  }

  const bubbleEntries = buildBubbleEntriesFromGroups_(groups);
  const guideAltText = trimAltText_(buildCarouselAltText_(bubbleEntries));

  if (includeGuideBubble && reminderText) {
    bubbleEntries.unshift({
      bubble: createAutoReminderGuideBubble_(reminderText, guideAltText),
      nearTermDates: []
    });
  }

  return { bubbleEntries: bubbleEntries };
}

/** 予定がないときの文の返事（入れ方つき） */
function createSheetErrorMessage_() {
  return {
    type: "text",
    text: SHEET_ERROR_TEXT
  };
}

/** 最後のメッセージに、送り主とクイックリプライ（QUICK_REPLY_SETS.cards）をつける */
function attachReminderQuickReply_(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    return messages;
  }

  const decorated = messages.map(message => Object.assign({}, message));
  const lastIndex = decorated.length - 1;

  decorated[lastIndex].sender = SENDERS.Auto;
  decorated[lastIndex].quickReply = {
    items: QUICK_REPLY_SETS.cards()
  };

  return decorated;
}

// ---------- 横に並べる ----------

/** 予定を月ごとにまとめる（月のリンクもつける） */
function buildMonthlyFlexGroups_(records, now, nearTermWeatherSummaryMap) {
  const groupsByMonth = new Map();

  records.forEach(record => {
    const key = buildYearMonthKey_(record.date);

    if (!groupsByMonth.has(key)) {
      groupsByMonth.set(key, {
        monthDate: new Date(record.date.getFullYear(), record.date.getMonth(), 1),
        records: []
      });
    }

    groupsByMonth.get(key).records.push(record);
  });

  return Array.from(groupsByMonth.values()).map(group => ({
    monthLabel: buildMonthLabel_(group.monthDate),
    records: group.records,
    // 月の共通リンク（いちばん多いリンク。公開カレンダーと同じ）。なければボタンを出さない（シートはサイト作成者だけ）
    link: usableCardLink_(findMonthCommonLink_(buildYearMonthKey_(group.monthDate)) || findFirstLink_(group.records)),
    now,
    nearTermWeatherSummaryMap
  }));
}

/** 月ごとのまとまりから、カードと近い予定の日付を作る */
function buildBubbleEntriesFromGroups_(groups) {
  return groups.map(group => ({
    bubble: createMonthlyFlexBubble_(group),
    nearTermDates: collectNearTermDates_(group.records, group.now)
  }));
}

/** カードを12枚ずつ、横に並べたメッセージにする */
function buildCarouselMessages_(bubbleEntries) {
  const messages = [];

  for (let i = 0; i < bubbleEntries.length; i += FLEX_CONFIG.maxBubblesPerCarousel) {
    const chunk = bubbleEntries.slice(i, i + FLEX_CONFIG.maxBubblesPerCarousel);

    messages.push({
      type: "flex",
      altText: trimAltText_(buildCarouselAltText_(chunk)),
      contents: {
        type: "carousel",
        contents: chunk.map(entry => entry.bubble)
      }
    });
  }

  return messages;
}

/** 横に並べたカードの通知文（見出し＋近い予定の日付） */
function buildCarouselAltText_(bubbleEntries) {
  const baseTitle = getRandomAltTextTitle_();
  const nearTermDateLabels = collectNearTermDateLabels_(bubbleEntries);

  if (nearTermDateLabels.length) {
    return `${baseTitle} (${nearTermDateLabels.join(", ")})`;
  }

  return baseTitle;
}

/** 通知文の見出しを1つ選ぶ */
function getRandomAltTextTitle_() {
  return _pickRandom_(RANDOM_TEXTS.title) || ALT_TEXT_CONFIG.defaultTitle;
}

/** 近い（もうすぐの）予定の日付の文字の並び */
function collectNearTermDates_(records, now) {
  return records
    .filter(record => isNearTermDate_(record.date, now, FLEX_CONFIG.nearTermDays))
    .map(record => formatMonthDay_(record.date));
}

/** カードの並びから、近い予定の日付を重ならないように集める */
function collectNearTermDateLabels_(bubbleEntries) {
  const labels = bubbleEntries.flatMap(entry => entry.nearTermDates || []);
  return Array.from(new Set(labels));
}

// ---------- カードの部品 ----------

/** カードの見出し（青い帯に白い文字） */
function createFlexHeader_(title) {
  return {
    type: "box",
    layout: "vertical",
    backgroundColor: FLEX_CONFIG.headerBackgroundColor,
    paddingAll: FLEX_CONFIG.headerPadding,
    contents: [
      {
        type: "text",
        text: title,
        color: "#ffffff",
        weight: "bold",
        size: "lg",
        wrap: true
      }
    ]
  };
}

/**
 * カードの見出し（青い帯に、小さな一言と、白い太字の題）。確認カード・テストのカード・自己点検で使う。
 * wrapTitle なら、題が長いときに折り返す
 */
function createFlexTwoLineHeader_(subText, titleText, wrapTitle) {
  const title = { type: "text", text: titleText, size: "lg", weight: "bold", color: "#ffffff" };
  if (wrapTitle) title.wrap = true;
  return {
    type: "box",
    layout: "vertical",
    backgroundColor: FLEX_CONFIG.headerBackgroundColor,
    paddingAll: FLEX_CONFIG.headerPadding,
    contents: [
      { type: "text", text: subText, size: "xs", color: "#ffffff" },
      title
    ]
  };
}

/** 通知カードの先頭の「リマインド送信ガイド」（文面とコピーのピル・管理・グループ・リッチに送る） */
function createAutoReminderGuideBubble_(reminderText, altText) {
  const clipboardText = trimClipboardText_(reminderText);
  return {
    type: "bubble",
    size: "mega",
    header: createFlexHeader_(AUTO_REMINDER_GUIDE_CONFIG.headerTitle),
    hero: createGuideReminderTextBox_(clipboardText),
    body: {
      type: "box",
      layout: "vertical",
      paddingTop: "8px",
      paddingBottom: "2px",
      contents: [
        createGuideNoteText_("右のカードが送信されます"),
        createGuideNoteText_(`件名：${altText || ALT_TEXT_CONFIG.defaultTitle}`)
      ]
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        createGuideButtonRow_([
          createGuideButton_({ type: "uri", label: AUTO_REMINDER_GUIDE_CONFIG.adminButtonLabel, uri: LIFF_URLS.Admin }),
          createGuideButton_({ type: "uri", label: AUTO_REMINDER_GUIDE_CONFIG.groupButtonLabel, uri: GROUP_LINK })
        ]),
        {
          type: "button",
          style: "primary",
          action: { type: "uri", label: AUTO_REMINDER_GUIDE_CONFIG.richButtonLabel, uri: LIFF_URLS.FlexSender }
        }
      ]
    }
  };
}

/** 送信ガイドの上の段：「これまでのテキスト文面」と、その文面 */
function createGuideReminderTextBox_(text) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    paddingAll: FLEX_CONFIG.cardPadding,
    backgroundColor: AUTO_REMINDER_GUIDE_CONFIG.cardBackgroundColor,
    contents: [
      {
        type: "box",
        layout: "horizontal",
        alignItems: "center",
        contents: [
          {
            type: "text",
            text: AUTO_REMINDER_GUIDE_CONFIG.bodyLabel,
            size: "xs",
            weight: "bold",
            color: AUTO_REMINDER_GUIDE_CONFIG.guideAccentColor,
            flex: 1
          },
          createGuideCopyPill_(text)
        ]
      },
      {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        backgroundColor: AUTO_REMINDER_GUIDE_CONFIG.bodyBackgroundColor,
        cornerRadius: FLEX_CONFIG.cardCornerRadius,
        contents: [
          { type: "text", text: text, size: "xs", color: AUTO_REMINDER_GUIDE_CONFIG.bodyTextColor, wrap: true }
        ]
      }
    ]
  };
}

/** 見出しの右の小さな「コピー」のピル（押すと文面をコピー。いつ押しても困らない） */
function createGuideCopyPill_(text) {
  return {
    type: "box",
    layout: "vertical",
    flex: 0,
    paddingTop: "4px",
    paddingBottom: "4px",
    paddingStart: "12px",
    paddingEnd: "12px",
    cornerRadius: "20px",
    borderWidth: "1px",
    borderColor: AUTO_REMINDER_GUIDE_CONFIG.guideAccentColor,
    backgroundColor: AUTO_REMINDER_GUIDE_CONFIG.bodyBackgroundColor,
    action: { type: "clipboard", label: AUTO_REMINDER_GUIDE_CONFIG.copyButtonLabel, clipboardText: text },
    contents: [
      { type: "text", text: AUTO_REMINDER_GUIDE_CONFIG.copyButtonLabel, size: "xxs", weight: "bold", color: AUTO_REMINDER_GUIDE_CONFIG.guideAccentColor, align: "center" }
    ]
  };
}

/** 送信ガイドの中ほどの、小さな説明の文字 */
function createGuideNoteText_(text) {
  return { type: "text", text: text, size: "xs", color: FLEX_CONFIG.summaryTextColor, align: "center", wrap: true };
}

/** 送信ガイドのボタンを2つ横に並べる段 */
function createGuideButtonRow_(buttons) {
  return { type: "box", layout: "horizontal", spacing: "sm", contents: buttons };
}

/** 送信ガイドの灰色のボタン */
function createGuideButton_(action) {
  return { type: "button", style: "secondary", flex: 1, action: action };
}

/** 1か月分の予定カード（見出し・予定・ほか○件・月のリンク） */
function createMonthlyFlexBubble_(group) {
  const { monthLabel, records, link, now, nearTermWeatherSummaryMap } = group;
  const title = `${monthLabel}の予定`;
  const summaryText = buildMonthlySummaryText_(records);

  return {
    type: "bubble",
    size: "mega",
    header: createFlexHeader_(title),
    hero: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: buildMonthlyRecordContents_(records, now, nearTermWeatherSummaryMap, link)
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingTop: "8px",
      paddingBottom: "2px",
      contents: [
        {
          type: "text",
          text: summaryText,
          size: "xs",
          color: FLEX_CONFIG.summaryTextColor,
          align: "center",
          wrap: false,
          maxLines: 1
        }
      ]
    },
    // リンクが無いときは footer ごと出さない（LINE は中身が空の箱を受けつけない）
    footer: link
      ? {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            action: {
              type: "uri",
              label: `${monthLabel}のリンクを開く`,
              uri: link
            }
          }
        ]
      }
      : undefined
  };
}

/** 月のカードに並べる予定（上から決めた数まで）。monthLink は月の共通リンク（ピルを付けるかを決める） */
function buildMonthlyRecordContents_(records, now, nearTermWeatherSummaryMap, monthLink) {
  const visibleRecords = records.slice(0, FLEX_CONFIG.maxVisibleRecordsPerMonth);
  const anyLink = Boolean(monthLink) || records.some(record => usableCardLink_(record.link));
  return visibleRecords.map(record => createRecordBox_(record, {
    now,
    nearTermWeatherSummaryMap,
    pillLink: anyLink ? recordPillLink_(record, monthLink) : undefined
  }));
}

/**
 * 予定の箱に入れるピルのリンク。月の共通リンクとちがうリンクならそのリンク、リンクなしなら ""（灰色で押せない）、
 * 共通リンクの予定はピルなし（undefined。月のボタンで開く）
 */
function recordPillLink_(record, monthLink) {
  if (record.noLink) return "";
  const own = usableCardLink_(record.link);
  return own && own !== monthLink ? own : undefined;
}

/** 予定の箱の中のピル「📝 回答する」（押すと link）か、灰色で押せない「リンクなし」 */
function createLinkPill_(link) {
  const on = Boolean(link);
  return {
    type: "box",
    layout: "vertical",
    flex: 0,
    paddingTop: "4px",
    paddingBottom: "4px",
    paddingStart: "10px",
    paddingEnd: "10px",
    cornerRadius: "100px",
    backgroundColor: on ? FLEX_CONFIG.linkPillColor : FLEX_CONFIG.linkPillOffColor,
    action: on ? { type: "uri", label: FLEX_CONFIG.linkPillLabel, uri: link } : undefined,
    contents: [
      {
        type: "text",
        text: on ? FLEX_CONFIG.linkPillLabel : FLEX_CONFIG.linkPillOffLabel,
        size: "xs",
        color: on ? FLEX_CONFIG.linkPillTextColor : FLEX_CONFIG.linkPillOffTextColor,
        align: "center"
      }
    ]
  };
}

/** 月のカードの下の「以上」か「他○件 (日付)」 */
function buildMonthlySummaryText_(records) {
  const hiddenCount = Math.max(records.length - FLEX_CONFIG.maxVisibleRecordsPerMonth, 0);
  if (hiddenCount <= 0) {
    return "以上";
  }

  const hiddenRecords = records.slice(FLEX_CONFIG.maxVisibleRecordsPerMonth);
  const previewText = hiddenRecords
    .map(record => {
      const dateLabel = formatCompactDateLabel_(record.date);
      const iconText = getSummaryIconText_(record.memo1);
      return `(${dateLabel}${iconText})`;
    })
    .join("");

  return `他${hiddenCount}件 ${previewText}`;
}

/** 予定1件の箱（アイコン・内容・日時・場所・もうすぐの印） */
function createRecordBox_(record, options) {
  const { now, nearTermWeatherSummaryMap, pillLink } = options;
  const isNearTerm = isNearTermDate_(record.date, now, FLEX_CONFIG.nearTermDays);
  const weatherSummary = isNearTerm
    ? (nearTermWeatherSummaryMap && nearTermWeatherSummaryMap[buildWeatherRecordKey_(record)]) || ""
    : "";

  return {
    type: "box",
    layout: "vertical",
    position: "relative",
    paddingAll: FLEX_CONFIG.cardPadding,
    backgroundColor: FLEX_CONFIG.recordBackgroundColor,
    cornerRadius: FLEX_CONFIG.cardCornerRadius,
    contents: [
      {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [createRecordIconBox_(record), createRecordDetailBox_(record, weatherSummary, pillLink)]
      },
      isNearTerm ? createNearTermBadge_() : null
    ].filter(Boolean)
  };
}

/** 予定の丸いアイコン（内容の1文字目）。押すと Google カレンダーに入れる画面を開く */
function createRecordIconBox_(record) {
  const calendarUrl = createGoogleCalendarUrl_(record);
  return {
    type: "box",
    layout: "vertical",
    flex: 0,
    width: FLEX_CONFIG.iconSize,
    height: FLEX_CONFIG.iconSize,
    justifyContent: "center",
    alignItems: "center",
    paddingAll: "0px",
    backgroundColor: FLEX_CONFIG.iconBackgroundColor,
    cornerRadius: FLEX_CONFIG.iconCornerRadius,
    action: calendarUrl ? { type: "uri", uri: calendarUrl } : undefined,
    contents: [
      {
        type: "text",
        text: getCalendarIconText_(record.memo1),
        size: "xl",
        weight: "bold",
        align: "center",
        gravity: "center",
        color: FLEX_CONFIG.iconTextColor,
        flex: 0
      }
    ]
  };
}

/** 予定の右側：内容・日時・天気（あれば）・場所と補足（あれば）・回答リンクのピル（pillLink が undefined でなければ） */
function createRecordDetailBox_(record, weatherSummary, pillLink) {
  const locationText = [record.place, record.memo2].filter(Boolean).join(" ");
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    spacing: "xs",
    contents: [
      {
        type: "text",
        text: getDisplayTitleText_(record.memo1),
        weight: "bold",
        size: "md",
        color: FLEX_CONFIG.textPrimaryColor,
        wrap: true
      },
      {
        type: "box",
        layout: "horizontal",
        spacing: "none",
        contents: buildRecordDateTimeContents_(record),
        flex: 0
      },
      weatherSummary
        ? { type: "text", text: `予報: ${weatherSummary}`, size: "xs", color: FLEX_CONFIG.weatherTextColor, wrap: true }
        : null,
      locationText
        ? { type: "text", text: locationText, size: "sm", color: FLEX_CONFIG.textSecondaryColor, wrap: true }
        : null,
      // ピルは横の箱に入れて、文字の長さの幅で左に寄せる
      pillLink !== undefined
        ? { type: "box", layout: "horizontal", paddingTop: "4px", contents: [createLinkPill_(pillLink)] }
        : null
    ].filter(Boolean)
  };
}

/** 予定の右上の「もうすぐ」の印 */
function createNearTermBadge_() {
  return {
    type: "box",
    layout: "horizontal",
    width: FLEX_CONFIG.badgeWidth,
    justifyContent: "center",
    alignItems: "center",
    contents: [
      {
        type: "text",
        text: "もうすぐ",
        size: "xs",
        color: FLEX_CONFIG.badgeTextColor,
        align: "center",
        gravity: "center"
      }
    ],
    backgroundColor: FLEX_CONFIG.badgeBackgroundColor,
    paddingAll: FLEX_CONFIG.badgePaddingAll,
    paddingStart: FLEX_CONFIG.badgePaddingHorizontal,
    paddingEnd: FLEX_CONFIG.badgePaddingHorizontal,
    flex: 0,
    position: "absolute",
    offsetEnd: FLEX_CONFIG.badgeOffset,
    offsetTop: FLEX_CONFIG.badgeOffset,
    cornerRadius: FLEX_CONFIG.badgeCornerRadius,
    height: FLEX_CONFIG.badgeHeight
  };
}

/** 「11月2日(日) 15:00-17:00」の部品（曜日だけ色を変える） */
function buildRecordDateTimeContents_(record) {
  const weekday = getJapaneseWeekday_(record.date);

  return [
    {
      type: "text",
      text: `${record.date.getMonth() + 1}月${record.date.getDate()}日(`,
      size: "sm",
      color: FLEX_CONFIG.textSecondaryColor,
      wrap: false,
      flex: 0
    },
    {
      type: "text",
      text: weekday,
      size: "sm",
      color: getWeekdayTextColor_(record.date),
      wrap: false,
      flex: 0
    },
    {
      type: "text",
      text: `) ${record.formatted.start}-${record.formatted.end}`,
      size: "sm",
      color: FLEX_CONFIG.textSecondaryColor,
      wrap: true,
      flex: 1
    }
  ];
}

/** カードのボタンに使えるリンク（http(s) で、LINE の上限の長さまで）。使えなければ空 */
function usableCardLink_(link) {
  const text = String(link || "").trim();
  return /^https?:\/\//.test(text) && text.length <= LINE_URI_MAX_CHARS_ ? text : "";
}

/** 予定の並びで、最初にあるリンク（なければ空文字） */
function findFirstLink_(records) {
  const recordWithLink = records.find(record => record.link);
  return recordWithLink ? recordWithLink.link : "";
}

/**
 * カレンダーに入れるリンク。長すぎるときは補足を外し、それでも長ければ空（リンクなし）にする
 */
function createGoogleCalendarUrl_(record) {
  if (!record || !record.date || !record.endDate) return "";

  const build = details => {
    const params = [
      "action=TEMPLATE",
      `text=${encodeURIComponent(record.memo1 || "予定")}`,
      `dates=${encodeURIComponent(`${formatGoogleCalendarDateTime_(record.date)}/${formatGoogleCalendarDateTime_(record.endDate)}`)}`,
      `location=${encodeURIComponent(record.place || "")}`,
      `details=${encodeURIComponent(details)}`,
      `ctz=${encodeURIComponent(scriptTimeZone_())}`
    ];
    return `https://calendar.google.com/calendar/render?${params.join("&")}`;
  };

  const url = build(record.memo2 || "");
  if (url.length <= LINE_URI_MAX_CHARS_) return url;

  const shorter = build("");
  return shorter.length <= LINE_URI_MAX_CHARS_ ? shorter : "";
}

/** Google カレンダーの登録リンクに使う日時の文字（yyyyMMddTHHmmss） */
function formatGoogleCalendarDateTime_(date) {
  return Utilities.formatDate(date, scriptTimeZone_(), "yyyyMMdd'T'HHmmss");
}

// ---------- 文字 ----------

/** 文字を maxChars 字までにする */
function truncateText_(text, maxChars) {
  return String(text || "").slice(0, maxChars);
}

/** 通知文（altText）を上限の長さまでにする */
function trimAltText_(text) {
  return truncateText_(text, ALT_TEXT_CONFIG.maxChars);
}

/** コピーの文字を上限の長さまでにする */
function trimClipboardText_(text) {
  return truncateText_(text, CLIPBOARD_TEXT_MAX_CHARS);
}

/** 内容の1文字目（絵文字も1文字として数える）。空なら undefined */
function firstCharOf_(memo1) {
  return Array.from(String(memo1 || "").trim())[0];
}

/** 予定のアイコンの文字（内容の1文字目。なければ「予」） */
function getCalendarIconText_(memo1) {
  return firstCharOf_(memo1) || "予";
}

/** 「他○件」に添える絵文字（内容の1文字目が絵文字のときだけ） */
function getSummaryIconText_(memo1) {
  const firstChar = firstCharOf_(memo1);
  return isEmojiLikeChar_(firstChar) ? firstChar : "";
}

/** カードに出す内容（先頭の絵文字はアイコンに出すので外す） */
function getDisplayTitleText_(memo1) {
  const normalized = String(memo1 || "").trim();
  if (!normalized) return "予定";

  const chars = Array.from(normalized);
  const firstChar = chars[0];

  if (isEmojiLikeChar_(firstChar)) {
    const remaining = chars.slice(1).join("").replace(/^\s+/, "");
    return remaining || normalized;
  }

  return normalized;
}

/** 絵文字か */
function isEmojiLikeChar_(char) {
  return !!char && /\p{Extended_Pictographic}/u.test(char);
}

/** 曜日の1文字（日〜土） */
function getJapaneseWeekday_(date) {
  return ["日", "月", "火", "水", "木", "金", "土"][date.getDay()] || "";
}

/** 曜日の色（日曜は赤・土曜は青） */
function getWeekdayTextColor_(date) {
  const weekday = date.getDay();
  if (weekday === 0) return FLEX_CONFIG.sundayTextColor;
  if (weekday === 6) return FLEX_CONFIG.saturdayTextColor;
  return FLEX_CONFIG.textSecondaryColor;
}

/** 「11/2日」の文字（日付＋曜日の1文字。日曜なら「日」） */
function formatCompactDateLabel_(date) {
  return `${formatMonthDay_(date)}${getJapaneseWeekday_(date)}`;
}
