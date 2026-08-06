const FLEX_CONFIG = {
  maxBubblesPerCarousel: 12,
  maxVisibleRecordsPerMonth: 4,
  nearTermDays: 5,
  headerBackgroundColor: "#4284F3",
  recordBackgroundColor: "#F6F8FB",
  iconBackgroundColor: "#E6EEF9",
  badgeBackgroundColor: "#FFE2BF",
  weatherBadgeBackgroundColor: "#E8F3FF",
  summaryTextColor: "#93A1B4",
  badgeTextColor: "#A54B00",
  weatherBadgeTextColor: "#3566A8",
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
  badgeOffset: "12px"
};

const ALT_TEXT_CONFIG = {
  defaultTitle: "🗓️ 活動日リマインド",
  maxChars: 1500
};

const AUTO_REMINDER_GUIDE_CONFIG = {
  headerTitle: "リマインド送信ガイド",
  bodyLabel: "これまでのテキスト文面",
  copyButtonLabel: "文章をコピー",
  sheetButtonLabel: "シート",
  richButtonLabel: "リッチに送る",
  cardBackgroundColor: "#FFF9EC",
  bodyBackgroundColor: "#FFFFFF",
  bodyTextColor: "#4B5563",
  guideAccentColor: "#B7791F"
};

function doGet(e) {
  try {
    const forceRefresh = !!(e && e.parameter && e.parameter.refresh === "1");
    const messages = createLiffPreviewMessages_(forceRefresh);

    return ContentService
      .createTextOutput(JSON.stringify({
        ok: true,
        messages
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({
        ok: false,
        message: err.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function createLiffPreviewMessages_(forceRefresh) {
  const records = extractUpcomingRecordsWithDateObjects(forceRefresh);
  const reminderText = buildReminderTextMessageTextFromRecords_(records);
  const messages = buildReminderFlexMessages_(records, {
    forceRefresh: !!forceRefresh,
    includeGuideBubble: true,
    reminderText: reminderText
  });
  return attachReminderQuickReply_(messages);
}

function createShareFlexMessages_(forceRefresh) {
  const records = extractUpcomingRecordsWithDateObjects(forceRefresh);
  const messages = buildReminderFlexMessages_(records, {
    forceRefresh: !!forceRefresh
  });
  return attachReminderQuickReply_(messages);
}

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

function buildReminderFlexMessages_(records, options) {
  const viewModel = buildReminderFlexViewModel_(records, options);

  if (viewModel.errorMessage) {
    return [viewModel.errorMessage];
  }

  return buildCarouselMessages_(viewModel.bubbleEntries);
}

function buildReminderFlexViewModel_(records, options) {
  const { forceRefresh, includeGuideBubble, reminderText } = options || {};
  const now = new Date();

  if (!records.length) {
    return {
      errorMessage: {
        type: "text",
        text: `🚨エラーが発生しました。\n⚠️シートを確認してね。\n${SETTING.SheetLink}`
      }
    };
  }

  const nearTermWeatherSummaryMap = getNearTermWeatherSummaryMap_(
    records,
    now,
    FLEX_CONFIG.nearTermDays,
    !!forceRefresh
  );
  const groups = buildMonthlyFlexGroups_(records, now, nearTermWeatherSummaryMap);

  if (!groups.length) {
    return {
      errorMessage: {
        type: "text",
        text: `🚨表示できる予定がありません。\n${SETTING.SheetLink}`
      }
    };
  }

  const bubbleEntries = buildBubbleEntriesFromGroups_(groups);
  const guideAltText = trimAltText_(buildCarouselAltText_(bubbleEntries));

  if (includeGuideBubble && reminderText) {
    bubbleEntries.unshift({
      bubble: createAutoReminderGuideBubble_(reminderText, guideAltText),
      nearTermDates: []
    });
  }

  return {
    bubbleEntries: bubbleEntries
  };
}

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
    link: findFirstLink_(group.records) || SETTING.SheetLink,
    now,
    nearTermWeatherSummaryMap
  }));
}

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

function buildCarouselAltText_(bubbleEntries) {
  const baseTitle = getRandomAltTextTitle_();
  const nearTermDateLabels = collectNearTermDateLabels_(bubbleEntries);

  if (nearTermDateLabels.length) {
    return `${baseTitle} (${nearTermDateLabels.join(", ")})`;
  }

  return baseTitle;
}

function getRandomAltTextTitle_() {
  if (typeof RANDOM_TEXTS !== "undefined" && RANDOM_TEXTS.title && RANDOM_TEXTS.title.length) {
    return _pickRandom_(RANDOM_TEXTS.title);
  }

  return ALT_TEXT_CONFIG.defaultTitle;
}

function collectNearTermDates_(records, now) {
  return records
    .filter(record => {
      const diffDays = diffDaysFromToday_(record.date, now);
      return diffDays >= 0 && diffDays <= FLEX_CONFIG.nearTermDays;
    })
    .map(record => formatNearTermDateLabel_(record.date));
}

function collectNearTermDateLabels_(bubbleEntries) {
  const labels = bubbleEntries.flatMap(entry => entry.nearTermDates || []);
  return Array.from(new Set(labels));
}

function formatNearTermDateLabel_(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function trimAltText_(text) {
  const normalized = String(text || "");
  if (normalized.length <= ALT_TEXT_CONFIG.maxChars) {
    return normalized;
  }

  return normalized.slice(0, ALT_TEXT_CONFIG.maxChars);
}

function createAutoReminderGuideBubble_(reminderText, altText) {
  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: FLEX_CONFIG.headerBackgroundColor,
      paddingAll: FLEX_CONFIG.headerPadding,
      contents: [
        {
          type: "text",
          text: AUTO_REMINDER_GUIDE_CONFIG.headerTitle,
          color: "#ffffff",
          weight: "bold",
          size: "lg",
          wrap: true
        }
      ]
    },
    hero: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: FLEX_CONFIG.cardPadding,
      backgroundColor: AUTO_REMINDER_GUIDE_CONFIG.cardBackgroundColor,
      contents: [
        {
          type: "text",
          text: AUTO_REMINDER_GUIDE_CONFIG.bodyLabel,
          size: "xs",
          weight: "bold",
          color: AUTO_REMINDER_GUIDE_CONFIG.guideAccentColor
        },
        {
          type: "box",
          layout: "vertical",
          paddingAll: "12px",
          backgroundColor: AUTO_REMINDER_GUIDE_CONFIG.bodyBackgroundColor,
          cornerRadius: FLEX_CONFIG.cardCornerRadius,
          contents: [
            {
              type: "text",
              text: trimClipboardText_(reminderText),
              size: "xs",
              color: AUTO_REMINDER_GUIDE_CONFIG.bodyTextColor,
              wrap: true
            }
          ]
        }
      ]
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingTop: "8px",
      paddingBottom: "2px",
      contents: [
        {
          type: "text",
          text: "右のカードが送信されます",
          size: "xs",
          color: FLEX_CONFIG.summaryTextColor,
          align: "center",
          wrap: true
        },
        {
          type: "text",
          text: `件名：${altText || ALT_TEXT_CONFIG.defaultTitle}`,
          size: "xs",
          color: FLEX_CONFIG.summaryTextColor,
          align: "center",
          wrap: true
        }
      ]
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          spacing: "sm",
          contents: [
            {
              type: "button",
              style: "secondary",
              flex: 1,
              action: {
                type: "clipboard",
                label: AUTO_REMINDER_GUIDE_CONFIG.copyButtonLabel,
                clipboardText: trimClipboardText_(reminderText)
              }
            },
            {
              type: "button",
              style: "secondary",
              flex: 1,
              action: {
                type: "uri",
                label: AUTO_REMINDER_GUIDE_CONFIG.sheetButtonLabel,
                uri: SETTING.SheetLink
              }
            }
          ]
        },
        {
          type: "button",
          style: "primary",
          action: {
            type: "uri",
            label: AUTO_REMINDER_GUIDE_CONFIG.richButtonLabel,
            uri: LIFF_URLS.FlexSender
          }
        }
      ]
    }
  };
}

function buildBubbleEntriesFromGroups_(groups) {
  return groups.map(group => ({
    bubble: createMonthlyFlexBubble_(group),
    nearTermDates: collectNearTermDates_(group.records, group.now)
  }));
}

function trimClipboardText_(text) {
  const normalized = String(text || "");
  if (normalized.length <= 1000) {
    return normalized;
  }

  return normalized.slice(0, 1000);
}

function attachReminderQuickReply_(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    return messages;
  }

  const decorated = messages.map(message => Object.assign({}, message));
  const lastIndex = decorated.length - 1;

  decorated[lastIndex].sender = SENDERS.Auto;
  decorated[lastIndex].quickReply = {
    items: [ACTIONS.FlexSender, ACTIONS.SS, ACTIONS.Plan]
  };

  return decorated;
}

function createMonthlyFlexBubble_(group) {
  const { monthLabel, records, link, now, nearTermWeatherSummaryMap } = group;
  const title = `${monthLabel}の予定`;
  const summaryText = buildMonthlySummaryText_(records);

  return {
    type: "bubble",
    size: "mega",
    header: {
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
    },
    hero: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: buildMonthlyRecordContents_(records, now, nearTermWeatherSummaryMap)
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
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: link
        ? [
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
        : []
    }
  };
}

function buildMonthlyRecordContents_(records, now, nearTermWeatherSummaryMap) {
  const visibleRecords = records.slice(0, FLEX_CONFIG.maxVisibleRecordsPerMonth);
  return visibleRecords.map(record => createRecordBox_(record, {
    now,
    nearTermWeatherSummaryMap
  }));
}

function buildMonthlySummaryText_(records) {
  const hiddenCount = Math.max(records.length - FLEX_CONFIG.maxVisibleRecordsPerMonth, 0);
  if (hiddenCount <= 0) {
    return "以上";
  }

  const hiddenRecords = records.slice(FLEX_CONFIG.maxVisibleRecordsPerMonth);
  if (!hiddenRecords.length) {
    return `他${hiddenCount}件`;
  }

  const previewText = hiddenRecords
    .map(record => {
      const dateLabel = formatCompactDateLabel_(record.date);
      const iconText = getSummaryIconText_(record.memo1);
      return `(${dateLabel}${iconText})`;
    })
    .join("");

  return `他${hiddenCount}件 ${previewText}`;
}

function createRecordBox_(record, options) {
  const { now, nearTermWeatherSummaryMap } = options;
  const diffDays = diffDaysFromToday_(record.date, now);
  const isNearTerm = diffDays >= 0 && diffDays <= FLEX_CONFIG.nearTermDays;
  const locationText = [record.place, record.memo2].filter(Boolean).join(" ");
  const calendarUrl = createGoogleCalendarUrl_(record);
  const iconText = getCalendarIconText_(record.memo1);
  const titleText = getDisplayTitleText_(record.memo1);
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
        contents: [
          {
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
            action: calendarUrl
              ? {
                type: "uri",
                uri: calendarUrl
              }
              : undefined,
            contents: [
              {
                type: "text",
                text: iconText,
                size: "xl",
                weight: "bold",
                align: "center",
                gravity: "center",
                color: FLEX_CONFIG.iconTextColor,
                flex: 0
              }
            ]
          },
          {
            type: "box",
            layout: "vertical",
            flex: 1,
            spacing: "xs",
            contents: [
              {
                type: "text",
                text: titleText,
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
                ? {
                  type: "text",
                  text: `天気: ${weatherSummary}`,
                  size: "xs",
                  color: FLEX_CONFIG.weatherTextColor,
                  wrap: true
                }
                : null,
              locationText
                ? {
                  type: "text",
                  text: locationText,
                  size: "sm",
                  color: FLEX_CONFIG.textSecondaryColor,
                  wrap: true
                }
                : null
            ].filter(Boolean)
          }
        ]
      },
      isNearTerm
        ? {
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
        }
        : null
    ].filter(Boolean)
  };
}

function getCalendarIconText_(memo1) {
  const normalized = String(memo1 || "").trim();
  const firstChar = Array.from(normalized)[0];
  return firstChar || "予";
}

function getSummaryIconText_(memo1) {
  const normalized = String(memo1 || "").trim();
  const firstChar = Array.from(normalized)[0];
  return isEmojiLikeChar_(firstChar) ? firstChar : "";
}

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

function isEmojiLikeChar_(char) {
  return !!char && /\p{Extended_Pictographic}/u.test(char);
}

function getJapaneseWeekday_(date) {
  return ["日", "月", "火", "水", "木", "金", "土"][date.getDay()] || "";
}

function getWeekdayTextColor_(date) {
  const weekday = date.getDay();
  if (weekday === 0) return FLEX_CONFIG.sundayTextColor;
  if (weekday === 6) return FLEX_CONFIG.saturdayTextColor;
  return FLEX_CONFIG.textSecondaryColor;
}

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

function formatCompactDateLabel_(date) {
  return `${date.getMonth() + 1}/${date.getDate()}${getJapaneseWeekday_(date)}`;
}
