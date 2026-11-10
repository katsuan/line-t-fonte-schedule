// 3つの画面（リッチに送る・公開カレンダー・管理ページ）で同じ設定。ほかの js より先に読む。
// GAS 側の同じ値は 00_setup.gs（LIFF_URLS・GROUP_LINK）にある。変えるときは両方を

/** LIFF アプリの ID（リッチに送る・管理ページ） */
const LIFF_ID = "2009927582-9QtOstUK";

/** GAS のウェブアプリ（doGet・doPost） */
const GAS_URL = "https://script.google.com/macros/s/AKfycbzXgPNJkiAB4eGVUwExQ8ehA8wMM93rSGk8OcvZe-1fo6ozalkr4Ov83KCwouA5WN1K/exec";

/** 通知を送る LINE グループのリンク */
const GROUP_LINK = "line://ti/g/hwc5nRC7mS";
