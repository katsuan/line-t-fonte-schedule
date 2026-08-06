# T-FONTE_reminder

Google Apps Script で動く、予定リマインド配信プロジェクトです。
Spreadsheet の予定を読み取り、LINE 向けのテキスト通知と Flex Message を生成します。

## Structure

- `reminderCore.gs`
  予定取得、キャッシュ、リマインド判定、テキスト文面生成
- `webappFlexEndpoint.gs`
  Web App 入口と Flex Message の整形
- `handleTextMessage.gs`
  テキストトリガーのルーティング
- `00_LoggerLib.gs`
  Logger 初期化
- `appsscript.json`
  Apps Script マニフェスト
- `docs/project_rules.md`
  このプロジェクト専用のローカル RULES

## Rules

共通ルールは `/Users/katsu/GitHub/RULES` を参照し、このプロジェクトでは [docs/project_rules.md](/Users/katsu/GitHub/T-FONTE_reminder/docs/project_rules.md) を追加ルールとして扱います。

特に次を固定方針にします。

- 入口は薄くし、取得・判定・表示を分ける
- GAS のローカルソースを正本にする
- Flex Message の表示都合を判定ロジックへ混ぜない
- quick reply や導線付きメッセージで次の操作を切らさない

## Entry Points

- `doGet`
  Web App から Flex Message JSON を返す
- `handleTextMessage`
  チャット上のテキストトリガーを解釈して返答メッセージを選ぶ
- `main`
  定期実行を想定した自動リマインド送信処理

## Config And Dependencies

- タイムゾーンは `Asia/Tokyo`
- 外部ライブラリは `LINE_func`, `LineApiDriver`, `LoggerLib`
- 環境依存値は `SETTING`, `SHEETS`, `ACTIONS`, `SENDERS`, `LIFF_URLS`, `WEATHER_CONFIG` などの設定側で管理する前提
- Script Properties にはキャッシュや送信済みキーを保存する

## Refactoring Policy

- 大きな 1 ファイル構成のままでも、入口・取得・判定・表示の境界は守る
- 新しい機能追加時は、まず既存の責務へ乗るか確認する
- `reminderCore.gs` の weather / cache、`webappFlexEndpoint.gs` の renderer 群は今後の分割候補
