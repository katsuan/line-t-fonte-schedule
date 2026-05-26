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

  const bubbles = groups.map(createMonthlyFlexBubble_);
  return buildCarouselMessages_(bubbles);
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
    emphasizeNearTerm: isSameYearMonth_(group.monthDate, now.getFullYear(), now.getMonth()),
    now
  }));
}

function buildCarouselMessages_(bubbles) {
  const maxBubblesPerCarousel = 12;
  const messages = [];

  for (let i = 0; i < bubbles.length; i += maxBubblesPerCarousel) {
    const chunk = bubbles.slice(i, i + maxBubblesPerCarousel);

    messages.push({
      type: "flex",
      altText: buildCarouselAltText_(chunk),
      contents: {
        type: "carousel",
        contents: chunk
      }
    });
  }

  return messages;
}

function buildCarouselAltText_(bubbles) {
  if (typeof RANDOM_TEXTS !== "undefined" && RANDOM_TEXTS.title && RANDOM_TEXTS.title.length) {
    return _pickRandom_(RANDOM_TEXTS.title);
  }

  return "🗓️ 活動日リマインド";
}

function createMonthlyFlexBubble_(group) {
  const { monthLabel, records, link, emphasizeNearTerm, now } = group;
  const title = `${monthLabel}の今後予定`;

  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#4284F3",
      paddingAll: "16px",
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
      contents: records.map(record => createRecordBox_(record, {
        emphasizeNearTerm,
        now
      }))
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

function createRecordBox_(record, options) {
  const { emphasizeNearTerm, now } = options;
  const isNearTerm = emphasizeNearTerm && diffDaysFromToday_(record.date, now) <= 5;
  const locationText = [record.place, record.memo2].filter(Boolean).join(" ");
  const calendarUrl = createGoogleCalendarUrl_(record);
  const iconText = getCalendarIconText_(record.memo1);

  const contents = [
    {
      type: "box",
      layout: "horizontal",
      spacing: "sm",
      alignItems: "center",
      contents: [
        {
          type: "box",
          layout: "vertical",
          flex: 0,
          paddingAll: "6px",
          backgroundColor: "#E6EEF9",
          cornerRadius: "999px",
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
              size: "sm",
              align: "center",
              gravity: "center",
              color: "#1F2937",
              flex: 0
            }
          ]
        },
        {
          type: "text",
          text: String(record.memo1 || "予定"),
          weight: "bold",
          size: "md",
          color: "#222222",
          wrap: true,
          flex: 1
        },
      ]
    },
    isNearTerm
      ? {
        type: "box",
        layout: "horizontal",
        justifyContent: "flex-end",
        contents: [
          {
            type: "text",
            text: "もうすぐ",
            size: "xs",
            color: "#A54B00",
            backgroundColor: "#FFE2BF",
            paddingAll: "4px",
            cornerRadius: "999px",
            align: "center",
            gravity: "center",
            flex: 0
          }
        ]
      }
      : null,
    {
      type: "text",
      text: `${record.formatted.date} ${record.formatted.start}-${record.formatted.end}`,
      size: "sm",
      color: "#555555",
      wrap: true
    }
  ].filter(Boolean);

  if (locationText) {
    contents.push({
      type: "text",
      text: locationText,
      size: "sm",
      color: "#555555",
      wrap: true
    });
  }

  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    paddingAll: "12px",
    backgroundColor: "#F6F8FB",
    cornerRadius: "12px",
    contents
  };
}

function getCalendarIconText_(memo1) {
  const normalized = String(memo1 || "").trim();
  const firstChar = Array.from(normalized)[0];
  return firstChar || "予";
}
