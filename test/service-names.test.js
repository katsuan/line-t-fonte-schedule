// 名前（T-FONTE）を、コードの文字に直書きしていないか。
// LINE に出す名前は 00_setup.gs の <service-names> のかたまり（SERVICE_NAME_）にだけ書き、ほかはそれを読む。
// HTML の <title>・見出しは JS を待たずに出すので直書きでよい（ここでは見ない）
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const SETUP = path.join(ROOT, "00_setup.gs");

/** <service-names> のかたまりを取り出して、値を読む */
function loadNameBlock() {
  const text = fs.readFileSync(SETUP, "utf8");
  const start = text.indexOf("// <service-names>");
  const end = text.indexOf("// </service-names>");
  assert.ok(start >= 0 && end > start, "00_setup.gs に <service-names> のかたまりがない");
  const block = text.slice(start, end);
  return { block, values: vm.runInNewContext(`${block}\n({ SERVICE_NAME_ })`) };
}

/** 1行の中の文字（'…'・"…"・`…`）だけ。コメントの中は見ない */
function stringsOf(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return [];
  return line.match(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g) || [];
}

test("名前は <service-names> のかたまりにだけ書く（ほかは SERVICE_NAME_ を読む）", () => {
  const { block, values } = loadNameBlock();
  const name = values.SERVICE_NAME_.name;
  assert.ok(name);
  // 15_availability.gs はひしょっとの写し（availability.test.js が元と同じかを見る）
  const files = fs.readdirSync(ROOT).filter((f) => /\.(gs|js)$/.test(f) && f !== "15_availability.gs")
    .concat(fs.readdirSync(path.join(ROOT, "js")).filter((f) => f.endsWith(".js")).map((f) => `js/${f}`));
  const found = [];
  files.forEach((file) => {
    let text = fs.readFileSync(path.join(ROOT, file), "utf8");
    if (file === "00_setup.gs") text = text.replace(block, "");
    text.split("\n").forEach((line, index) => {
      if (stringsOf(line).some((literal) => literal.includes(name))) found.push(`${file}:${index + 1}`);
    });
  });
  assert.deepEqual(found, []);
});
