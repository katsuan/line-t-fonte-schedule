# T-FONTE_reminder Project Rules

## 目的

このファイルは、共通 `RULES` を `T-FONTE_reminder` 向けに具体化したローカルルールです。
GAS と LINE メッセージ生成が中心のため、責務分離、設定管理、メッセージ体験、運用時の安全性を明確にします。

参照元:

- `/Users/katsu/GitHub/RULES/01_architecture_and_implementation_rules.md`
- `/Users/katsu/GitHub/RULES/04_naming_and_directory_rules.md`
- `/Users/katsu/GitHub/RULES/05_messaging_experience_rules.md`

## このプロジェクトで固定する責務

- `handleTextMessage.gs`
  テキスト入力の解釈と、どのメッセージ生成処理を呼ぶかのルーティングだけを持つ
- `webappFlexEndpoint.gs`
  Web App 入口と、Flex Message 用の整形・表示ロジックを持つ
- `reminderCore.gs`
  予定取得、キャッシュ、リマインド判定、テキスト文面生成の共通ロジックを持つ
- `00_LoggerLib.gs`
  ログ初期化だけを持つ

## 追加ルール

### 1. 入口は薄く保つ

- `doGet` と `handleTextMessage` に業務判断を増やしすぎない
- 新しい入力トリガーは、条件分岐を直書きで増やす前にルーティング関数へ集約する
- 将来 `doPost` や定期実行の入口が増えても、共通ロジックは `reminderCore.gs` か専用関数へ寄せる

### 2. 予定データの取得と表示整形を分ける

- Spreadsheet 読み取り、Properties キャッシュ、天気 API 呼び出しは取得責務として扱う
- 月別グルーピング、表示件数制御、altText 組み立て、Flex bubble 組み立ては表示責務として扱う
- 表示都合の値を、リマインド送信判定の条件として逆流させない

### 3. 設定値は意味ごとにまとめる

- UI 設定は `FLEX_CONFIG` や `AUTO_REMINDER_GUIDE_CONFIG` のように用途別に持つ
- キャッシュや保持日数のような運用設定は `reminderCore.gs` 側へ置く
- Script Properties に置くべき値はコードへ直書きしない

### 4. メッセージ体験は「確認しやすさ」を優先する

- 予定一覧は比較しやすい順序で並べる
- 最後のメッセージに quick reply を付け、次の行動を切らさない
- 自動送信向けメッセージでは、送信される本文と遷移先が追えるガイドを維持する

### 5. GAS 運用ルール

- ローカルファイルを正本とし、Apps Script エディタだけで修正を完結させない
- `appsscript.json` と `.gs` ファイルの責務差を README に残す
- キャッシュキーや保存形式を変える場合は、既存 Script Properties への影響を明示する

## リファクタリング方針

- 1 回の変更で責務をまたぐ巨大改修は避ける
- まず重複除去、命名改善、入口の簡素化から進める
- ファイル分割を行う場合は、README とこのルールの責務定義を同時に更新する

## 次に分割候補となる領域

- `reminderCore.gs` 内の weather 取得まわり
- `reminderCore.gs` 内の upcoming records cache まわり
- `webappFlexEndpoint.gs` 内の Flex bubble renderer 群
