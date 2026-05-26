function doGet(e) {
  try {
    const message = createShareFlexMessage_();

    return ContentService
      .createTextOutput(JSON.stringify({
        ok: true,
        messages: [message]
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

function createShareFlexMessage_() {
  const records = extractUpcomingRecordsWithDateObjects();

  if (!records.length) {
    return {
      type: "text",
      text: `🚨エラーが発生しました。\n⚠️シートを確認してね。\n${SETTING.SheetLink}`
    };
  }

  const first = records[0];
  const merged = [first];

  for (let i = 1; i < records.length; i++) {
    const next = records[i];
    const diffDays = (next.date.getTime() - first.date.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays <= 3) {
      merged.push(next);
    } else {
      break;
    }
  }

  const title = _pickRandom_(RANDOM_TEXTS.title);
  const intro = _pickRandom_(RANDOM_TEXTS.intro);
  const closing = _pickRandom_(RANDOM_TEXTS.closing);

  return {
    type: "flex",
    altText: title,
    contents: createReminderBubble_({
      title,
      intro,
      closing,
      records: merged,
      link: first.link
    })
  };

  function createReminderBubble_(params) {
    const { title, intro, closing, records, link } = params;

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
            text: intro,
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
        contents: [
          ...records.map(createRecordBox_),
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "※各予定タップでGoogleカレンダーに追加",
            size: "xs",
            color: "#888888",
            wrap: true,
          },

        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: link
          ? [
            {
              type: "text",
              text: closing,
              size: "sm",
              color: "#555555",
              wrap: true,
            },
            {
              type: "button",
              style: "primary",
              action: {
                type: "uri",
                label: "回答状況確認",
                uri: link
              }
            }
          ]
          : []
      }
    };
  }
}

function createRecordBox_(record) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    paddingAll: "12px",
    backgroundColor: "#F6F8FB",
    cornerRadius: "12px",
    contents: [
      {
        type: "text",
        text: String(record.memo1 || "予定"),
        weight: "bold",
        size: "md",
        color: "#222222",
        wrap: true
      },
      {
        type: "text",
        text: `${record.formatted.date} ${record.formatted.start}-${record.formatted.end}`,
        size: "sm",
        color: "#555555",
        wrap: true
      },
      {
        type: "text",
        text: `${record.place || ""}${record.memo2 || ""}`,
        size: "sm",
        color: "#555555",
        wrap: true
      }
    ]
  };
}