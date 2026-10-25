// ==========[ 1回の呼び出しの中での読み取りの使い回し ]==========
//
// 同じシートや設定を何度も読むと遅いので、1回目に読んだものを使い回す（memo_）。
// 呼び出しが終われば消える。シートに書いたら forgetMemo_ で捨てる。どのファイルからも使う

/** 1回の呼び出しの中で使い回す読み取り結果 */
const REQUEST_MEMO_ = {};

/** key の読み取り結果を、1回目だけ build() で作って使い回す */
function memo_(key, build) {
  if (!Object.prototype.hasOwnProperty.call(REQUEST_MEMO_, key)) {
    REQUEST_MEMO_[key] = build();
  }
  return REQUEST_MEMO_[key];
}

/** 使い回している key の読み取り結果を捨てる（シートに書いたあとに呼ぶ） */
function forgetMemo_(key) {
  delete REQUEST_MEMO_[key];
}
