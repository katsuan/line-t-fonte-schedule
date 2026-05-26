const FLEX_CONFIG = {
  maxBubblesPerCarousel: 12,
  maxVisibleRecordsPerMonth: 5,
  nearTermDays: 5,
  headerBackgroundColor: "#4284F3",
  recordBackgroundColor: "#F6F8FB",
  iconBackgroundColor: "#E6EEF9",
  badgeBackgroundColor: "#FFE2BF",
  summaryTextColor: "#5B6B7F",
  badgeTextColor: "#A54B00",
  textPrimaryColor: "#222222",
  textSecondaryColor: "#555555",
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
  nearTermPromptSuffix: "の予定が近づいています！"
};

function doGet(e) {
  try {
    const messages = createShareFlexMessages_();

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

function createShareFlexMessages_() {
  const records = extractUpcomingRecordsWithDateObjects();

  if (!records.length) {
    return [{
      type: "text",
      text: `🚨エラーが発生しました。\n⚠️シートを確認してね。\n${SETTING.SheetLink}`
    }];
  }

  const groups = buildMonthlyFlexGroups_(records, new Date());

  if (!groups.length) {
    return [{
      type: "text",
      text: `🚨表示できる予定がありません。\n${SETTING.SheetLink}`
    }];
  }

  const bubbleEntries = groups.map(group => ({
    bubble: createMonthlyFlexBubble_(group),
    nearTermDates: collectNearTermDates_(group.records, group.now)
  }));
  return buildCarouselMessages_(bubbleEntries);
}

function buildMonthlyFlexGroups_(records, now) {
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
    now
  }));
}

function buildCarouselMessages_(bubbleEntries) {
  const messages = [];

  for (let i = 0; i < bubbleEntries.length; i += FLEX_CONFIG.maxBubblesPerCarousel) {
    const chunk = bubbleEntries.slice(i, i + FLEX_CONFIG.maxBubblesPerCarousel);

    messages.push({
      type: "flex",
      altText: buildCarouselAltText_(chunk),
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
    return `${nearTermDateLabels.join(", ")}${ALT_TEXT_CONFIG.nearTermPromptSuffix} ${baseTitle}`;
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

function createMonthlyFlexBubble_(group) {
  const { monthLabel, records, link, now } = group;
  const title = `${monthLabel}の予定`;

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
      contents: buildMonthlyRecordContents_(records, now)
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

function buildMonthlyRecordContents_(records, now) {
  const visibleRecords = records.slice(0, FLEX_CONFIG.maxVisibleRecordsPerMonth);
  const hiddenCount = Math.max(records.length - visibleRecords.length, 0);
  const contents = visibleRecords.map(record => createRecordBox_(record, { now }));

  if (hiddenCount > 0) {
    contents.push({
      type: "text",
      text: `他${hiddenCount}件`,
      size: "sm",
      color: FLEX_CONFIG.summaryTextColor,
      weight: "bold",
      align: "center",
      margin: "sm"
    });
  }

  return contents;
}

function createRecordBox_(record, options) {
  const { now } = options;
  const diffDays = diffDaysFromToday_(record.date, now);
  const isNearTerm = diffDays >= 0 && diffDays <= FLEX_CONFIG.nearTermDays;
  const locationText = [record.place, record.memo2].filter(Boolean).join(" ");
  const calendarUrl = createGoogleCalendarUrl_(record);
  const iconText = getCalendarIconText_(record.memo1);
  const titleText = getDisplayTitleText_(record.memo1);

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
                type: "text",
                text: `${record.formatted.date} ${record.formatted.start}-${record.formatted.end}`,
                size: "sm",
                color: FLEX_CONFIG.textSecondaryColor,
                wrap: true
              },
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
              text: "要回答",
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
