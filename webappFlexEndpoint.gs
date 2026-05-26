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
  const labels = bubbles
    .map(bubble => extractHeaderTitle_(bubble))
    .filter(Boolean);

  if (!labels.length) {
    return "今後予定を共有します";
  }

  if (labels.length === 1) {
    return `${labels[0]}を共有します`;
  }

  return `${labels[0]}から${labels[labels.length - 1]}までの予定を共有します`;
}

function extractHeaderTitle_(bubble) {
  const texts = bubble && bubble.header && bubble.header.contents;
  if (!Array.isArray(texts) || !texts.length) return "";

  const titleNode = texts.find(item => item.type === "text" && item.text);
  return titleNode ? String(titleNode.text) : "";
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
        },
        {
          type: "text",
          text: emphasizeNearTerm
            ? "未来予定をまとめています。直近5日は強調表示です。"
            : "この月の未来予定をまとめています。",
          color: "#ffffff",
          size: "sm",
          margin: "sm",
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
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "text",
          text: "※各予定のボタンからGoogleカレンダーに追加できます。",
          size: "xs",
          color: "#888888",
          wrap: true
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

function createRecordBox_(record, options) {
  const { emphasizeNearTerm, now } = options;
  const isNearTerm = emphasizeNearTerm && diffDaysFromToday_(record.date, now) <= 5;
  const locationText = [record.place, record.memo2].filter(Boolean).join(" ");
  const calendarUrl = createGoogleCalendarUrl_(record);

  const titleRowContents = [
    {
      type: "text",
      text: String(record.memo1 || "予定"),
      weight: "bold",
      size: "md",
      color: "#222222",
      wrap: true,
      flex: 1
    }
  ];

  if (isNearTerm) {
    titleRowContents.push({
      type: "text",
      text: getApproachingLabel_(record.date, now),
      size: "xs",
      color: "#A54B00",
      backgroundColor: "#FFE2BF",
      paddingAll: "4px",
      cornerRadius: "999px",
      gravity: "center",
      align: "center",
      flex: 0
    });
  }

  const contents = [
    {
      type: "box",
      layout: "horizontal",
      spacing: "sm",
      contents: titleRowContents
    },
    {
      type: "text",
      text: `${record.formatted.date} ${record.formatted.start}-${record.formatted.end}`,
      size: "sm",
      color: isNearTerm ? "#A54B00" : "#555555",
      wrap: true
    }
  ];

  if (locationText) {
    contents.push({
      type: "text",
      text: locationText,
      size: "sm",
      color: "#555555",
      wrap: true
    });
  }

  if (calendarUrl) {
    contents.push({
      type: "button",
      style: "link",
      height: "sm",
      action: {
        type: "uri",
        label: "Googleカレンダーに追加",
        uri: calendarUrl
      }
    });
  }

  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    paddingAll: "12px",
    backgroundColor: isNearTerm ? "#FFF7ED" : "#F6F8FB",
    cornerRadius: "12px",
    contents
  };
}
