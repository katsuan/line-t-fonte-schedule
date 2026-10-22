# T-FONTE_reminder

Google Apps Script で動く、予定リマインド配信プロジェクトです。
Spreadsheet の予定を読み取り、LINE 向けのテキスト通知と Flex Message を生成します。

## Structure

ファイル名の先頭番号はレイヤーを表す（共通 RULES の `04_naming_and_directory_rules.md` 準拠）。

- `00_*` 共通設定・ロガー・デバッグログ
- `10_*` ドメインロジック（予定取得・リマインド判定・予定登録パース）
- `20_*` ルーティング（テキストトリガー解釈）
- `30_*` Web入口・Flex表示整形

同じ番号内の並びは責務の近さを表し、実行順を厳密に保証するものではない（`00_const.gs` はグローバル定数の初期化が他ファイルより先に必要なため、番号にかかわらず必ず最初に評価される前提を保つ）。

- `00_const.gs`
  Spreadsheet・設定値・アイコン・quick reply アクションなどのグローバル初期化
- `00_LoggerLib.gs`
  Logger 初期化
- `00_debugLog.gs`
  親プロジェクトの実行ログを確認できない場合向けの、スプレッドシート(`DebugLog`シート)への簡易ログ出力
- `00_memo.gs`
  1回の呼び出しの中で、同じシートや設定の読み取りを使い回す（`memo_` / `forgetMemo_`）
- `10_reminderCore.gs`
  今後の予定の読み取り、リマインド判定・送信済みの記録、テキスト文面生成
- `11_scheduleRegistration.gs`
  `#予定登録` からのテキスト予定一括登録（パース・確認保留・確定）
- `12_upcomingRecordsCache.gs`
  今後の予定のキャッシュ（Script Properties に月ごとに保存し、日付が変わったら作り直す）
- `13_planSheet.gs`
  Plan シートの読み書きの共通部分。読み取りは1回の呼び出しで1回だけにして使い回し、書いたら `forgetPlanValues_` で捨てる。行の追加・同月リンクの補完もここ
- `14_weather.gs`
  天気（Open-Meteo）の取得とキャッシュ。いまは `WEATHER_CONFIG.Enabled = false` で止めている
- `20_handleTextMessage.gs`
  テキストトリガーのルーティング
- `30_webappFlexEndpoint.gs`
  Web App 入口と Flex Message の整形
- `31_adminApi.gs`
  管理者ページ用 API（`doPost`）。LIFF アクセストークンを LINE API で検証し、Script Property `ADMIN_USER_IDS`（カンマ区切りの userId）に含まれる人だけが予定の一覧・追加・編集・削除を行える
- `34_adminBulkAdd.gs`
  管理ページの「📝 文章で追加」用。チャットの `#予定登録` と同じ流れ（プレーンテキスト入力 → 入力値の分解 → 確認 → 登録）。読み取りは `11_scheduleRegistration.gs` のパーサを再利用し、確認用の読み取り（`parseSchedule`、書き込まない）と、確認済みの予定のまとめて登録（`addBatch`、1件でも不正なら全件書き込まない）に分ける。登録済みと同じ予定（日付・開始・場所）は、確認画面で未チェックにする
- `32_publicCalendarApi.gs`
  公開カレンダー用の読み取り API（`doGet` の `?action=plans`）。同期先カレンダーの登録リンク（`subscribeUrl`）も返すが、カレンダーIDがメールアドレス形式（個人のメインカレンダー）のときは、IDが読み取れてしまうため返さない（専用カレンダー `@group.calendar.google.com` のときだけ返す）。Plan シートの「更新バージョン」（スプレッドシートのドキュメント公開範囲メタデータ）をキーにキャッシュし、予定を書き込む処理（管理ページ・`#予定確定`）がバージョンを進める。シートを手で編集した場合は、GAS エディタで `installPlanChangeTrigger` を一度だけ実行して変更検知トリガーを作る（未実行でも有効期限1時間で自然に更新される）
- `33_calendarSync.gs`
  Plan シートの今日以降の予定を Google カレンダーへ反映する（シート→カレンダーの一方向）。このシステムが作った予定だけにタグを付けて追加・削除し、手で作った予定や過去の予定には触れない。カレンダーIDは Script Property `CALENDAR_ID`（子プロジェクト側）。カレンダーの予定は、タイトル=内容、場所=場所、説明欄=「補足＋改行＋リンク」で作る。初期設定は、`authorizeCalendarSync`（権限の承認）→ `installCalendarSyncTrigger`（1日1回の定期トリガー）を GAS エディタで一度ずつ実行する。同期するタイミングは、管理ページの保存直後、「📅 カレンダー同期」ボタン、シートの手編集（`installPlanChangeTrigger` の変更検知トリガー）、1日1回の定期トリガー（LINE の `#予定確定` など、他で拾えない変更の取りこぼし対策）
  **注意**: カレンダーを扱う権限が増えるため、子を `clasp push` すると、子をライブラリ（開発モード）で使う親プロジェクト（LINE Webhook）も再承認が必要になる。push の前に手順を確認すること
- `admin.html`
  管理者ページ（別ページ）。LIFF 経由で `https://liff.line.me/<LIFF_ID>/admin.html` から開く。管理者未登録のときは自分の userId を表示するので、それを `ADMIN_USER_IDS` に追加する
- `appsscript.json`
  Apps Script マニフェスト

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

- 大きな 1 ファイル構成のままでも、入口・取得・判定・表示の境界は守る
- 新しい機能追加時は、まず既存の責務へ乗るか確認する
- `30_webappFlexEndpoint.gs` の renderer 群は今後の分割候補
