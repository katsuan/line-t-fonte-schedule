// ==========[ 管理者にしてほしい人を、サイト作成者がトークで承認する ]==========
//
// 三つの立場で分ける：
// - ユーザ（管理者でない人）… 管理ページの「サイト作成者に送る」で、頼む文（#管理者申請 <ID>）をサイト作成者に送る
// - 管理者（ADMIN_USER_IDS）… 予定を直せる。ほかの人を管理者にはできない
// - サイト作成者（OWNER_USER_IDS）… 頼む文をボットに送ると、クイックリプライの「承認する」で ADMIN_USER_IDS に足せる
// OWNER_USER_IDS は Script Property に手で入れる（ボットからは変えない）。
// ボットは押した人をそのつど確かめ、もう管理者・ID がちがう・サイト作成者でない、を見分けて返す

/** 管理者の申請の設定 */
const ADMIN_REQUEST_CONFIG = {
  ownerUserIdsProperty: "OWNER_USER_IDS",
  requestWord: "#管理者申請",
  approveWord: "#管理者承認",
  lockWaitMs: 10000
};

/** LINE の userId の形（U と 32 けたの16進数） */
const ADMIN_REQUEST_USER_ID_PATTERN_ = /\bU[0-9a-f]{32}\b/;

/** 「#管理者申請 U…」「#管理者承認 U…」か（全角の＃も） */
function isAdminRequestText_(text) {
  return /^[#＃]管理者(申請|承認)/.test(String(text || "").trim());
}

/** サイト作成者（Script Property `OWNER_USER_IDS`）か */
function isSiteOwnerUserId_(userId) {
  return Boolean(userId) && readUserIdList_(ADMIN_REQUEST_CONFIG.ownerUserIdsProperty).indexOf(userId) !== -1;
}

/** 頼む文の例（管理ページの「サイト作成者に送る」で入れる文と同じ形） */
function buildAdminRequestExample_(userId, name) {
  return [
    `${ADMIN_REQUEST_CONFIG.requestWord} ${userId}`,
    name ? `名前: ${name}` : "",
    "（サイト作成者の方へ：この文をそのままボットに送ると、承認のボタンが出ます）"
  ].filter(Boolean).join("\n");
}

/** 「#管理者申請」「#管理者承認」の返事（申請 → 承認の確かめ、承認 → ADMIN_USER_IDS に足す） */
function createAdminRequestMessages_(text, event) {
  const source = String(text || "").trim();
  const presser = (event && event.source && event.source.userId) || "";
  const match = source.match(ADMIN_REQUEST_USER_ID_PATTERN_);

  if (!match) {
    return [adminRequestReply_(`ID が読めませんでした。管理ページの「サイト作成者に送る」で入る文を、そのまま送ってください。\n\n例:\n${buildAdminRequestExample_("U0123456789abcdef0123456789abcdef", "山田")}`)];
  }
  const userId = match[0];

  // 承認できるのはサイト作成者だけ。ほかの人が送ったら、サイト作成者に送ってもらう
  if (!isSiteOwnerUserId_(presser)) {
    return [adminRequestReply_("管理者を足せるのは、サイト作成者だけです。この文を、サイト作成者に送ってください。")];
  }
  if (isAdminUserId_(userId)) return [alreadyAdminReply_(userId)];

  if (/^[#＃]管理者承認/.test(source)) return [approveAdminRequest_(userId)];

  const name = (source.match(/名前[:：]\s*(.+)/) || [])[1];
  return [adminRequestReply_(
    `この人を管理者にしますか？\n${name ? `名前: ${name.trim().slice(0, 40)}\n` : ""}ID: ${userId}\n\n管理者になると、予定の管理ページで予定を足す・直す・消すことができます。`,
    [approveQuickReplyItem_(userId)]
  )];
}

/** ADMIN_USER_IDS に足す（ロックの中で、もう入っていれば足さない） */
function approveAdminRequest_(userId) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(ADMIN_REQUEST_CONFIG.lockWaitMs)) {
    return adminRequestReply_("ほかの操作中です。少し待ってから、もう一度「承認する」を押してください。", [approveQuickReplyItem_(userId)]);
  }
  try {
    const current = readUserIdList_(ADMIN_API_CONFIG.adminUserIdsProperty);
    if (current.indexOf(userId) !== -1) return alreadyAdminReply_(userId);
    PropertiesService.getScriptProperties().setProperty(ADMIN_API_CONFIG.adminUserIdsProperty, current.concat(userId).join(","));
  } finally {
    lock.releaseLock();
  }
  return adminRequestReply_(`✅ 管理者にしました（${maskAdminRequestUserId_(userId)}）。\n本人が管理ページを開き直すと使えます。`, [ACTIONS.Admin]);
}

/** クイックリプライの「承認する」 */
function approveQuickReplyItem_(userId) {
  return LINE_func.createQuickReply("承認する", { text: `${ADMIN_REQUEST_CONFIG.approveWord} ${userId}` });
}

/** 「もう管理者です」 */
function alreadyAdminReply_(userId) {
  return adminRequestReply_(`この人（${maskAdminRequestUserId_(userId)}）は、もう管理者です。`);
}

/** ID の頭と終わりだけ（トークに何度も全部を出さない） */
function maskAdminRequestUserId_(userId) {
  return `${userId.slice(0, 5)}…${userId.slice(-4)}`;
}

/** 申請の返事（文とクイックリプライ） */
function adminRequestReply_(text, quickItems) {
  const message = { type: "text", text: text, sender: SENDERS.Auto };
  if (quickItems && quickItems.length) message.quickReply = { items: quickItems };
  return message;
}
