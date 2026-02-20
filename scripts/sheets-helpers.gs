/**
 * スプレッドシート用ヘルパー: UUID / カラーコード生成
 * 使い方: スプレッドシートのメニュー「ヘルパー」から実行
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ヘルパー')
    .addItem('UUID を挿入', 'insertUuid')
    .addItem('カラーコードを挿入', 'insertColor')
    .addToUi();
}

/** 選択セルに UUID を挿入 */
function insertUuid() {
  var range = SpreadsheetApp.getActiveRange();
  var cells = range.getValues();
  for (var i = 0; i < cells.length; i++) {
    for (var j = 0; j < cells[i].length; j++) {
      cells[i][j] = Utilities.getUuid();
    }
  }
  range.setValues(cells);
}

/** 選択セルにランダムカラーコードを挿入（背景色もプレビュー） */
function insertColor() {
  var range = SpreadsheetApp.getActiveRange();
  var cells = range.getValues();
  var backgrounds = [];
  for (var i = 0; i < cells.length; i++) {
    backgrounds[i] = [];
    for (var j = 0; j < cells[i].length; j++) {
      var color = randomColor();
      cells[i][j] = color;
      backgrounds[i][j] = color;
    }
  }
  range.setValues(cells);
  range.setBackgrounds(backgrounds);
}

function randomColor() {
  var r = Math.floor(Math.random() * 200 + 40);
  var g = Math.floor(Math.random() * 200 + 40);
  var b = Math.floor(Math.random() * 200 + 40);
  return '#' + hex(r) + hex(g) + hex(b);
}

function hex(n) {
  return ('0' + n.toString(16)).slice(-2).toUpperCase();
}
