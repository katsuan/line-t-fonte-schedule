# T-FONTE_reminder

Google Apps Script で動く、予定リマインド配信プロジェクトです。
Spreadsheet の予定を読み取り、LINE 向けのテキスト通知と Flex Message を生成します。

## ファイル

並べ方と名前は、Q のツール共通の決まり（q-oqrn の `docs/structure.md`）にそろえている。

### GAS（`clasp push` で送るのは `.gs` と `appsscript.json` だけ。`.claspignore`）

GAS はファイルを名前の順に1つずつ読む。読みこみ時（トップレベル）に、あとのファイルの関数・定数を直接使わない（`test/load-order.test.js` で確かめる）。

| ファイル | 中身 |
|---|---|
| `00_setup.gs` | 人が GAS エディタから実行する関数（`runSelfCheck` 自己点検 → `authorizeCalendarSync` → `installCalendarSyncTrigger` → `installPlanChangeTrigger`）と、人が書きかえる設定（LIFF の URL・グループのリンク・終了時刻の既定・天気）。先頭に、どの順に何を実行するか |
| `01_entry.gs` | 入口。ウェブアプリ（`doGet`・`doPost`）、親の LINE ボットから呼ばれる関数（`handleTextMessage`・`shouldSendRemindMessage`・`createAutoReminderSenderName`・`createAutoReminderMessages`・`completeAutoReminderSend`・`createMessage`・`main`）、トリガー（`onPlanSheetChanged`・`syncPlansToCalendarJob`）。名前を変えると親・トリガーが動かなくなる |
| `02_init.gs` | 読みこみ時の準備：シート・Setting の設定・アイコン・日付の書式・クイックリプライ・送り主 |
| `03_request-memo.gs` | 1回の呼び出しの中で、同じシートや設定の読み取りを使い回す（`memo_` / `forgetMemo_`） |
| `04_debug-log.gs` | DebugLog シートへのログ（親の実行ログを見られないとき用。LINE の ID はそのまま残さない） |
| `05_dates.gs` | 日付の小さな道具（日付で数える・月のキー） |
| `10_plan-sheet.gs` | Plan シートの読み書き（外から来た文字は `safeCell_`）・同じ月のリンクで補う |
| `11_upcoming-records.gs` | これからの予定と、その日の控え（Script Properties に月ごと。日付が変わったら作り直す） |
| `12_reminder.gs` | 自動リマインド：通知する予定（今日から `RemindNum` 日後までで未通知）・送信済みの記録（60日）・文面 |
| `13_schedule-registration.gs` | `#予定登録`：文章の読み取り（タブ区切り・自由文）→ 確認カード → 「登録する」（`#予定確定 <下書きID>`）。ボタンは押されるたびに、済んだ・古い・ほかの人・時間切れを見分けて返す（親のボットに渡るのは文字のメッセージだけなので postback は使わない） |
| `14_weather.gs` | 天気（Open-Meteo）。いまは `WEATHER_CONFIG.Enabled = false` で止めている |
| `20_text-router.gs` | トークの文字の振り分け（`#予定登録`・`#今後の予定`・`#リマインド`・`#テスト` など） |
| `21_admin-test-desk.gs` | 管理者のテストの窓口。`ADMIN_USER_IDS` にいる人が `#テスト`（`#test`）と送ると 🧪 テストのカードが返り、返事・カードの見本と自己点検を試せる。見本はためしのデータで、本物には書かない。ふつうの人には何も返さない |
| `30_flex-cards.gs` | 予定のカード（月ごとのカード・通知カードの送信ガイド・画面に返す中身） |
| `31_admin-api.gs` | 管理ページの API。LIFF のアクセストークンを LINE に確かめ、`ADMIN_USER_IDS` の人だけが一覧・追加・編集・削除できる |
| `32_admin-bulk-add.gs` | 管理ページの「📝 文章で追加」（読み取りは `#予定登録` と同じ。1件でも不正なら書かない） |
| `33_public-calendar-api.gs` | 公開カレンダーの API（`doGet ?action=plans`）と予定の版。登録リンクは専用カレンダー（`@group.calendar.google.com`）のときだけ返す。シートを手で直したときの反映は `installPlanChangeTrigger` |
| `34_calendar-sync.gs` | Google カレンダー同期（シート→カレンダーの一方向。タグのある予定だけを足し・消す）。ID は Script Property `CALENDAR_ID` |
| `appsscript.json` | Apps Script マニフェスト |

**注意**: カレンダーなどの権限が増える変更を `clasp push` すると、このプロジェクトをライブラリ（開発モード）で使う親プロジェクト（LINE Webhook）も再承認が必要になる。push の前に手順を確認すること

### 画面（GitHub Pages。`.github/workflows/deploy-pages.yml` で公開）

| ファイル | 中身 |
|---|---|
| `index.html` ・ `app.js` ・ `style.css` | 予定シェア（LIFF「リッチに送る」）。GAS（`doGet`）のカードを見本に出し、LINE の友だち・グループに送る |
| `admin.html` ・ `admin.js` ・ `admin.css` | 予定の管理（LIFF。`https://liff.line.me/<LIFF_ID>/admin.html`）。管理者未登録のときは自分の userId を出すので、それを `ADMIN_USER_IDS` に足す |
| `calendar.html` ・ `calendar.js` ・ `calendar.css` | 公開の活動予定カレンダー（ログインなし） |
| `js/month-calendar.js` | 月の表の部品（曜日・週のはじまり・マス・アイコン・月のリンク・スワイプ）。`calendar.html`・`admin.html` が入口より先に読む |

JS・CSS を直したら、`python3 ../q-oqrn/tools/qstamp.py index.html admin.html calendar.html` で `?v=` を付け直す（LINE の中のブラウザが古いファイルを覚えているため）。

## 週のはじまり（カレンダー）

- 公開カレンダー（`calendar.html`）と管理ページ（`admin.html`）の月の表の下に「週のはじまり 日｜月」がある。既定は日曜はじまり（いままでどおり）
- 選んだものは、その端末の localStorage（`t_fonte_week_start`）に残る。2つのページで同じ設定を使う

## テスト

本番のシート・LINE に触らずに、偽物の GAS（`~/GitHub/q-oqrn/tools/qtest/fake-gas.js`）で主な流れを確かめる。

```bash
node --test test/*.test.js
node ~/GitHub/q-oqrn/tools/qtest/check-code.mjs .
```

- `test/reminder.test.js` 予定の読みこみ・自動リマインドの対象と送信済み・日付またぎ・月末・LINE のカード
- `test/registration.test.js` `#予定登録`／`#予定確定`（ない日付・二度押し・同時に動いたとき・シートの式）・振り分け
- `test/admin-test-desk.test.js` `#テスト`（管理者だけに返る・本物に書かない）
- `test/load-order.test.js` GAS と同じく1ファイルずつ読んでもエラーにならない・関数の前のコメント・`00_` の中身
- `test/admin.test.js` 管理ページの API（本人確認・権限・入力の確かめ・エラーの中身を出さない）と公開カレンダーの API

## 版情報

- デプロイ時に `version.json`（commit SHA・生成時刻）を公開ページ直下に生成する（`.github/workflows/deploy-pages.yml`）
- 公開ページの版確認は `<公開URL>/version.json` を参照する
- この仕組みは LearningPlatform の `docs/version.json` 自動更新パターンを移植したもの（2026-08-15）

## Rules

開発のルールは、開発者の手元で管理しています（非公開）。

特に次を固定方針にします。

- 入口は薄くし、取得・判定・表示を分ける
- GAS のローカルソースを正本にする
- Flex Message の表示都合を判定ロジックへ混ぜない
- quick reply や導線付きメッセージで次の操作を切らさない
- `shareTargetPicker` 向け送信データは、表示用 Flex と分けて安全側へ整形する

## Entry Points

- `doGet`
  Web App から Flex Message JSON を返す
- `handleTextMessage`
  チャット上のテキストトリガーを解釈して返答メッセージを選ぶ
- `main`
  定期実行を想定した自動リマインド送信処理
- `doPost`
  管理者ページからの予定の一覧・追加・編集・削除（要 `ADMIN_USER_IDS`）

## 自動リマインド（管理者への通知）

親プロジェクトの定期実行（`postRemainder`）が、管理者のLINEグループへ通知を送る。メンバーへの送信は、通知のカードから LIFF（`リッチに送る`）で、管理者自身が行う（グループ人数ぶんの送信数がかからない）。

- **通知する予定**: 今日から `RemindNum` 日後（`Setting` シートの B2）までの予定のうち、まだ通知していないもの。「ちょうど N 日後」ではなく期間で数えるので、定期実行が動かなかった日や、直前に追加した予定も、次の実行で通知される
- **送信済みの記録**: 通知の文面に入れた予定（直近の予定から `RemindNum` 日以内、日付で数える）を、送信後に記録する。同じ予定は、もう一度通知されない（記録は60日で消える）
- **設定が不正なとき**: `RemindNum` が数字でなければ、何も通知しない
- **通知カードのボタン**: 文章をコピー / シート / 予定を管理（管理ページ） / グループへ / リッチに送る。クイックリプライにも「予定を管理」がある
- **反映のしかた**: 親は子をライブラリ（開発モード）で使うため、子を `clasp push` すると、定期通知に即時反映される

## Config And Dependencies

- タイムゾーンは `Asia/Tokyo`
- 外部ライブラリは `LINE_func`, `LineApiDriver`, `LoggerLib`
- 環境依存値は `SETTING`, `SHEETS`, `ACTIONS`, `SENDERS`, `LIFF_URLS`, `WEATHER_CONFIG` などの設定側で管理する前提
- Script Properties にはキャッシュや送信済みキーを保存する

## Refactoring Policy

- 入口（`01_entry.gs`）は薄くし、取得・判定・表示を分ける
- 新しい機能を足すときは、まず今のファイルの役わりに乗るか確かめる
- ファイルの先頭に「何のためか・中に何があるか・どこから呼ばれるか」、関数の前に「何をするか」を書く（`test/load-order.test.js` で確かめる）
