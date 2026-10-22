// ==========[ 1回の呼び出しの中での読み取りの使い回し ]==========
// 同じシートや設定を何度も読むと遅いので、1回目に読んだものを使い回す。
// 呼び出しが終われば消える（次の呼び出しでは読み直す）。シートに書いたら forgetMemo_ で捨てる。

const REQUEST_MEMO_ = {};

function memo_(key, build) {
  if (!Object.prototype.hasOwnProperty.call(REQUEST_MEMO_, key)) {
    REQUEST_MEMO_[key] = build();
  }
  return REQUEST_MEMO_[key];
}

function forgetMemo_(key) {
  delete REQUEST_MEMO_[key];
}
