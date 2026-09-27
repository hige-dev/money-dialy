import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign, constants } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const projectDirectory = new URL("../../webapp-pilot/", import.meta.url);
const source = await readFile(new URL("Code.gs", projectDirectory), "utf8");
const manifest = JSON.parse(await readFile(new URL("appsscript.json", projectDirectory), "utf8"));
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = pair.publicKey.export({ format: "jwk" });
publicJwk.kid = "test-key";
const clientId = "family-ledger-test.apps.googleusercontent.com";
const propertyValues = { FAMILY_SPREADSHEET_ID: "spreadsheet-test", GOOGLE_OAUTH_CLIENT_ID: clientId, GOOGLE_OAUTH_CLIENT_SECRET: "test-client-secret" };
const loggedMessages = [];
const cache = new Map();
const renderedTemplates = [];
const stateTokens = [];
const tokenExchangeRequests = [];
const spreadsheetOpenCalls = [];
const externalFetchCalls = [];
const externalFetchBodyReads = [];
const scriptPropertyWrites = [];
const scriptPropertyDeletes = [];
const authorizationEvents = [];
let denyScriptPropertyWrites = false;
let denyAllScopeAuthorization = false;
let effectiveUserEmail = "owner-only@example.net";
let failTemplateCreation = false;
let oauthTokenResponse = "";
let certsResponseCode = 200;
let lockHeld = false;
let onRangeRead = null;
let failNextRequestPendingWrite = false;
let failNextRequestCompletion = false;
let failNextLedgerWrite = false;

class MemoryRange {
  constructor(sheet, row, column, rowCount, columnCount) { Object.assign(this, { sheet, row, column, rowCount, columnCount }); }
  getValues() {
    if (onRangeRead && onRangeRead(this.sheet.name)) onRangeRead = null;
    return Array.from({ length: this.rowCount }, (_, rowOffset) => Array.from({ length: this.columnCount }, (_, columnOffset) =>
      this.sheet.rows[this.row - 1 + rowOffset]?.[this.column - 1 + columnOffset] ?? ""));
  }
  setValues(values) {
    if (this.sheet.name === "Requests" && values.some((row) => row[6] === "pending") && failNextRequestPendingWrite) {
      failNextRequestPendingWrite = false;
      throw new Error("pending要求記録の試験書き込みに失敗しました。");
    }
    if (this.sheet.name === "Requests" && values.some((row) => row[6] === "complete") && failNextRequestCompletion) {
      failNextRequestCompletion = false;
      throw new Error("完了要求記録の試験書き込みに失敗しました。");
    }
    if (["Expenses", "WalletHistory"].includes(this.sheet.name) && failNextLedgerWrite) {
      failNextLedgerWrite = false;
      throw new Error("台帳行の試験書き込みに失敗しました。");
    }
    values.forEach((row, rowOffset) => {
      assert.equal(row.some((value) => typeof value === "string" && /^[\u0000-\u0020]*[=+\-@]/.test(value)), false, "数式に解釈される文字列は通常の値として渡さないでください");
      const rowIndex = this.row - 1 + rowOffset;
      while (this.sheet.rows.length <= rowIndex) this.sheet.rows.push([]);
      row.forEach((value, columnOffset) => { this.sheet.rows[rowIndex][this.column - 1 + columnOffset] = value; });
    });
    return this;
  }
  setRichTextValue(value) {
    const rowIndex = this.row - 1; const columnIndex = this.column - 1;
    while (this.sheet.rows.length <= rowIndex) this.sheet.rows.push([]);
    this.sheet.rows[rowIndex][columnIndex] = value.text;
    this.sheet.richTextWrites += 1;
    return this;
  }
}

class MemorySheet {
  constructor(name) { this.name = name; this.rows = []; this.richTextWrites = 0; }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getRange(row, column, rowCount = 1, columnCount = 1) { return new MemoryRange(this, row, column, rowCount, columnCount); }
  appendRow(row) { this.rows.push([...row]); return this; }
  deleteRow(row) { this.rows.splice(row - 1, 1); }
  setFrozenRows() { return this; }
}

class MemorySpreadsheet {
  constructor() { this.sheets = new Map(); }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) { const sheet = new MemorySheet(name); this.sheets.set(name, sheet); return sheet; }
}

const spreadsheet = new MemorySpreadsheet();
const users = spreadsheet.insertSheet("Users");
users.appendRow(["email", "name", "role", "defaultMemberId", "active", "updatedBy", "updatedAt"]);
users.appendRow(["admin@example.com", "管理者", "admin", "member-self", true, "", ""]);
users.appendRow(["member@example.com", "利用者", "member", "member-partner", true, "", ""]);
users.appendRow(["disabled@example.com", "停止中", "member", "member-self", false, "", ""]);
const remoteKeys = JSON.stringify({ keys: [publicJwk] });

const context = vm.createContext({
  SpreadsheetApp: { openById: (id) => { authorizationEvents.push("open-spreadsheet"); spreadsheetOpenCalls.push(id); return spreadsheet; }, newRichTextValue: () => ({ text: "", setText(value) { this.text = value; return this; }, build() { return { text: this.text }; } }) },
  HtmlService: { createTemplateFromFile: (filename) => {
    if (failTemplateCreation) throw new Error("未加工の画面生成エラー: test-client-secret owner-only@example.net");
    const template = { filename, evaluate: () => ({ template, addMetaTag() { return this; }, setTitle() { return this; } }) };
    renderedTemplates.push(template);
    return template;
  } },
  PropertiesService: { getScriptProperties: () => {
    authorizationEvents.push("get-script-properties");
    return ({
    getProperty: (key) => Object.prototype.hasOwnProperty.call(propertyValues, key) ? String(propertyValues[key]) : null,
    setProperty: (key, value) => {
      if (denyScriptPropertyWrites) throw new Error("一時確認用のプロパティ書込み拒否");
      const normalizedValue = String(value);
      scriptPropertyWrites.push({ key, value: normalizedValue });
      propertyValues[key] = normalizedValue;
      return this;
    },
    deleteProperty: (key) => { scriptPropertyDeletes.push(key); delete propertyValues[key]; return this; },
    getProperties: () => ({ ...propertyValues }),
    });
  } },
  CacheService: { getScriptCache: () => ({ get: (key) => cache.get(key) || null, put: (key, value) => cache.set(key, value) }) },
  ScriptApp: { AuthMode: { FULL: "FULL" }, requireAllScopes: (mode) => {
    authorizationEvents.push(`require-all-scopes:${mode}`);
    if (denyAllScopeAuthorization) throw new Error("全宣言スコープの承認が必要です。");
  }, newStateToken: () => {
    const state = { method: "", arguments: {}, timeout: 60 };
    return {
      withMethod(method) { state.method = method; return this; },
      withArgument(name, value) { state.arguments[name] = value; return this; },
      withTimeout(timeout) { state.timeout = timeout; return this; },
      createToken() { stateTokens.push(plain(state)); return `state-token-${stateTokens.length}`; },
    };
  } },
  UrlFetchApp: { fetch: (url, options = {}) => {
    if (url === "https://oauth2.googleapis.com/token") {
      tokenExchangeRequests.push({ url, options: plain(options) });
      return { getResponseCode: () => options.payload.code === "exchange-failure" ? 400 : 200, getContentText: () => oauthTokenResponse };
    }
    authorizationEvents.push("fetch-google-certs");
    externalFetchCalls.push({ url, options: plain(options) });
    return { getResponseCode: () => certsResponseCode, getContentText: () => { externalFetchBodyReads.push(url); return remoteKeys; }, getAllHeaders: () => ({ "Cache-Control": "public, max-age=3600" }) };
  } },
  LockService: { getScriptLock: () => ({ tryLock: () => { if (lockHeld) return false; lockHeld = true; return true; }, releaseLock: () => { lockHeld = false; } }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: "SHA-256" }, Charset: { UTF_8: "UTF-8" },
    base64Decode: (value) => [...Buffer.from(value, "base64")].map((byte) => byte > 127 ? byte - 256 : byte),
    newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes.map((byte) => (byte + 256) % 256)).toString("utf8") }),
    computeDigest: (_algorithm, value) => [...createHash("sha256").update(value, "utf8").digest()].map((byte) => byte > 127 ? byte - 256 : byte),
    getUuid: (() => { let id = 0; return () => String(++id).padStart(32, "0"); })(),
    formatDate: (date, _zone, _format) => date.toISOString().slice(0, 10),
  },
  Logger: { log: (message) => loggedMessages.push(String(message)) },
  Session: { getEffectiveUser: () => ({ getEmail: () => { authorizationEvents.push("get-effective-user-email"); return effectiveUserEmail; } }) },
  console,
});
vm.runInContext(source, context, { filename: "Code.gs" });

function makeToken(email, overrides = {}, tamper = false) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: publicJwk.kid || "test-key" };
  const payload = { iss: "https://accounts.google.com", aud: clientId, azp: clientId, sub: `sub-${email}`, email, email_verified: true, iat: now, exp: now + 3600, ...overrides };
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const content = `${enc(header)}.${enc(payload)}`;
  const signature = sign("RSA-SHA256", Buffer.from(content), { key: pair.privateKey, padding: constants.RSA_PKCS1_PADDING });
  const signed = tamper ? Buffer.from(signature).map((byte, index) => index === 0 ? byte ^ 1 : byte) : signature;
  return `${content}.${signed.toString("base64url")}`;
}

function expectError(callback, message) {
  let error;
  try { callback(); } catch (caught) { error = caught; }
  assert.ok(error, `エラー「${message}」が発生しませんでした`);
  assert.match(String(error.message), new RegExp(message));
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }
const authorizationSheetSnapshot = JSON.stringify([...spreadsheet.sheets.entries()].map(([name, sheet]) => [name, sheet.rows]));
const authorizationPropertiesSnapshot = JSON.stringify(propertyValues);
const authorizationStateTokenCount = stateTokens.length;
const authorizationFetchBodyReadCount = externalFetchBodyReads.length;
const authorizationPropertyWriteCount = scriptPropertyWrites.length;
const authorizationPropertyDeleteCount = scriptPropertyDeletes.length;
authorizationEvents.length = 0;
assert.deepEqual(manifest.oauthScopes, [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/script.external_request",
  "https://www.googleapis.com/auth/script.scriptapp",
  "https://www.googleapis.com/auth/script.storage",
  "https://www.googleapis.com/auth/userinfo.email",
], "承認ヘルパーが確認する全スコープを必要最小限の順序で宣言します");
assert.equal(typeof context.authorizeFamilyLedgerServices, "undefined", "危険な承認処理を公開RPC名にしません");
assert.equal(typeof context.authorizeFamilyLedgerServices_, "function", "承認確認処理は非公開関数として保持します");
const authorizationResult = context.authorizeFamilyLedgerServices_();
assert.equal(authorizationResult, "宣言済みスコープと実行アカウントの承認確認が完了しました。メールアドレスは保存せず、台帳と設定値も変更していません。", "新しいスコープ確認を識別できる日本語の完了メッセージを返します");
assert.equal(loggedMessages.at(-1), authorizationResult, "サービス承認確認の完了文をApps Script実行ログへ記録します");
assert.deepEqual(authorizationEvents.slice(0, 3), ["require-all-scopes:FULL", "get-effective-user-email", "get-script-properties"], "全スコープと実行アカウントを確認してから他サービスを使います");
assert.equal(JSON.stringify(propertyValues).includes(effectiveUserEmail), false, "実行アカウントのメールアドレスを保存しません");
assert.equal(JSON.stringify(loggedMessages).includes(effectiveUserEmail), false, "実行アカウントのメールアドレスをログへ出しません");
assert.equal(scriptPropertyWrites.length, authorizationPropertyWriteCount + 1, "承認確認時に一度だけ一時スクリプトプロパティを書き込みます");
assert.equal(scriptPropertyDeletes.length, authorizationPropertyDeleteCount + 1, "承認確認時に一時スクリプトプロパティを削除します");
const authorizationProbe = scriptPropertyWrites.at(-1);
assert.match(authorizationProbe.key, /^FAMILY_WEBAPP_AUTH_PROBE_[a-f0-9]{32}$/i, "一時プロパティにはランダムな専用キーを使います");
assert.equal(scriptPropertyDeletes.at(-1), authorizationProbe.key, "削除対象が書込み確認に使ったキーと一致します");
assert.equal(propertyValues[authorizationProbe.key], undefined, "一時プロパティは承認確認後に残しません");
assert.ok(!["FAMILY_SPREADSHEET_ID", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"].includes(authorizationProbe.key), "実設定プロパティを上書きしません");
assert.equal(spreadsheetOpenCalls.at(-1), "spreadsheet-test", "設定済みのスプレッドシートを読み取り専用で開きます");
assert.equal(externalFetchCalls.at(-1).url, "https://www.googleapis.com/oauth2/v3/certs", "Googleの公開鍵エンドポイントへ接続します");
assert.equal(externalFetchCalls.at(-1).options.muteHttpExceptions, true, "公開鍵応答本文を例外へ漏らしません");
assert.equal(stateTokens.length, authorizationStateTokenCount + 1, "Apps Script State Tokenサービスを呼び出します");
assert.equal(stateTokens.at(-1).method, "authCallback", "承認確認用State Tokenを既存のコールバックへ結びます");
assert.equal(externalFetchBodyReads.length, authorizationFetchBodyReadCount, "承認確認では公開鍵応答本文を読み取りません");
assert.equal(JSON.stringify([...spreadsheet.sheets.entries()].map(([name, sheet]) => [name, sheet.rows])), authorizationSheetSnapshot, "承認確認では既存シートや台帳を変更しません");
assert.equal(JSON.stringify(propertyValues), authorizationPropertiesSnapshot, "承認確認ではスクリプトプロパティを変更しません");
assert.equal(authorizationResult.includes(propertyValues.GOOGLE_OAUTH_CLIENT_SECRET), false, "完了メッセージへ秘密値を含めません");
const missingScopeEventsStart = authorizationEvents.length;
denyAllScopeAuthorization = true;
expectError(() => context.authorizeFamilyLedgerServices_(), "全宣言スコープの承認が必要です");
denyAllScopeAuthorization = false;
assert.deepEqual(authorizationEvents.slice(missingScopeEventsStart), ["require-all-scopes:FULL"], "宣言済みスコープ未承認なら他サービスに触れず停止します");
const blankEmailEventsStart = authorizationEvents.length;
const blankEmailPropertySnapshot = JSON.stringify(propertyValues);
effectiveUserEmail = "   ";
expectError(() => context.authorizeFamilyLedgerServices_(), "実行アカウントのメールアドレスを確認できません");
assert.deepEqual(authorizationEvents.slice(blankEmailEventsStart), ["require-all-scopes:FULL", "get-effective-user-email"], "空メールを検出したら設定や台帳へ進みません");
assert.equal(JSON.stringify(propertyValues), blankEmailPropertySnapshot, "実行アカウント情報が空でもプロパティを変更しません");
effectiveUserEmail = "owner-only@example.net";
denyScriptPropertyWrites = true;
const deniedPropertyDeleteCount = scriptPropertyDeletes.length;
expectError(() => context.authorizeFamilyLedgerServices_(), "スクリプトプロパティへの書き込み");
assert.equal(scriptPropertyDeletes.length, deniedPropertyDeleteCount + 1, "書込み権限がないときも一時キーを削除確認します");
denyScriptPropertyWrites = false;
propertyValues.FAMILY_SPREADSHEET_ID = "https://docs.google.com/spreadsheets/d/14w0QKAfolE1jRLqKeaf9dcE1h704l8wS3BDU06Ny4UI/edit?gid=0#gid=0";
context.authorizeFamilyLedgerServices_();
assert.equal(spreadsheetOpenCalls.at(-1), "14w0QKAfolE1jRLqKeaf9dcE1h704l8wS3BDU06Ny4UI", "スプレッドシートURLからIDを取り出して開きます");
propertyValues.FAMILY_SPREADSHEET_ID = "spreadsheet-test";
certsResponseCode = 403;
expectError(() => context.authorizeFamilyLedgerServices_(), "Google認証用の公開鍵に接続できませんでした");
certsResponseCode = 200;
const fallbackClientId = "971274774993-0qpfrqc5i8ct48kq5r2sb7sa7h5s4pou.apps.googleusercontent.com";
const configuredClientId = propertyValues.GOOGLE_OAUTH_CLIENT_ID;
propertyValues.GOOGLE_OAUTH_CLIENT_ID = "";
const initialDoGetLogStart = loggedMessages.length;
context.doGet();
const initialDoGetLogs = loggedMessages.slice(initialDoGetLogStart);
assert.ok(initialDoGetLogs.includes("doGet: 画面要求を受け付けました。"));
assert.ok(initialDoGetLogs.includes("doGet: ログイン画面を生成します。"));
assert.ok(initialDoGetLogs.includes("doGet: ログイン画面を返します。"));
const firstLoginState = stateTokens.at(-1);
const fallbackLoginUrl = new URL(renderedTemplates.at(-1).loginUrl);
assert.equal(fallbackLoginUrl.searchParams.get("client_id"), fallbackClientId, "内蔵OAuth client IDを認可URLへ設定します");
assert.equal(fallbackLoginUrl.searchParams.get("scope"), "openid email", "ログインではopenidとemailだけを要求します");
assert.equal(fallbackLoginUrl.searchParams.get("redirect_uri"), "https://script.google.com/macros/d/1zhqVIRy5YKrDURd77Tl5I4Za4f-1kvGqyJbvwnesW1HLFt8j7InXa3sQ/usercallback", "認可URLに固定のusercallback URIを指定します");
assert.equal(fallbackLoginUrl.searchParams.get("response_type"), "code", "ブラウザーには認証コードを返します");
assert.equal(fallbackLoginUrl.searchParams.get("state"), `state-token-${stateTokens.length}`);
assert.equal(firstLoginState.method, "authCallback", "Apps ScriptのState TokenをauthCallbackへ結びます");
assert.equal(firstLoginState.timeout, 300, "ログインstateは5分で期限切れにします");
assert.equal(firstLoginState.arguments.nonce, fallbackLoginUrl.searchParams.get("nonce"), "state token内のnonceがOAuth要求と一致します");
assert.equal(fallbackLoginUrl.href.includes(propertyValues.GOOGLE_OAUTH_CLIENT_SECRET), false, "認可URLにクライアントシークレットを含めません");
failTemplateCreation = true;
expectError(() => context.doGet(), "画面を表示できませんでした");
failTemplateCreation = false;
assert.ok(loggedMessages.includes("doGet: ログイン画面の生成に失敗しました。"), "doGetの失敗を固定文言で記録します");
assert.equal(JSON.stringify(loggedMessages).includes("未加工の画面生成エラー"), false, "doGetは生の例外をログへ出しません");
propertyValues.GOOGLE_OAUTH_CLIENT_SECRET = "";
context.doGet();
assert.equal(renderedTemplates.at(-1).loginUrl, "", "シークレット未設定時はログインリンクを表示しません");
assert.match(renderedTemplates.at(-1).loginMessage, /管理者のログイン設定/);
propertyValues.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
assert.equal(plain(context.verifyGoogleIdToken_(makeToken("admin@example.com", { aud: fallbackClientId, azp: fallbackClientId }))).aud, fallbackClientId, "Script Property未設定時も内蔵OAuth client ID宛ての署名済みtokenを検証します");
const overrideClientId = "family-ledger-override.apps.googleusercontent.com";
propertyValues.GOOGLE_OAUTH_CLIENT_ID = overrideClientId;
context.doGet();
assert.equal(new URL(renderedTemplates.at(-1).loginUrl).searchParams.get("client_id"), overrideClientId, "Script PropertyのOAuth client IDを内蔵値より優先します");
assert.equal(plain(context.verifyGoogleIdToken_(makeToken("admin@example.com", { aud: overrideClientId, azp: overrideClientId }))).aud, overrideClientId, "Script Property overrideとtoken検証の宛先が一致します");
expectError(() => context.verifyGoogleIdToken_(makeToken("admin@example.com", { aud: fallbackClientId, azp: fallbackClientId })), "宛先が正しくありません");
propertyValues.GOOGLE_OAUTH_CLIENT_ID = configuredClientId;

const callbackNonce = firstLoginState.arguments.nonce;
const callbackIdToken = makeToken("admin@example.com", { nonce: callbackNonce });
oauthTokenResponse = JSON.stringify({ id_token: callbackIdToken, access_token: "未使用アクセストークン", refresh_token: "未使用更新トークン" });
const successfulCallbackLogStart = loggedMessages.length;
context.authCallback({ parameter: { code: "one-time-code", nonce: callbackNonce } });
const successfulCallbackLogs = loggedMessages.slice(successfulCallbackLogStart);
assert.ok(successfulCallbackLogs.includes("authCallback: Googleからの認証応答を受け付けました。"));
assert.ok(successfulCallbackLogs.includes("authCallback: コールバック要求の形式を確認しました。"));
assert.ok(successfulCallbackLogs.includes("authCallback: 認証コードの交換が完了しました。"));
assert.ok(successfulCallbackLogs.includes("authCallback: IDトークンを検証しました。"));
assert.ok(successfulCallbackLogs.includes("authCallback: Usersシートの利用許可を確認しました。"));
assert.ok(successfulCallbackLogs.includes("authCallback: アプリセッションを発行しました。"));
assert.ok(successfulCallbackLogs.includes("authCallback: 認証済み画面を返します。"));
const callbackTemplate = renderedTemplates.at(-1);
assert.match(callbackTemplate.initialSessionId, /^[a-f0-9]{96}$/i, "OAuth成功後に高エントロピーのアプリセッションを発行します");
assert.notEqual(callbackTemplate.initialSessionId, callbackIdToken, "Google IDトークンをブラウザーへ渡しません");
assert.equal(callbackTemplate.deploymentGeneration, vm.runInContext("FAMILY_WEBAPP_SESSION_GENERATION_", context), "画面には現在の非秘密のデプロイ世代を渡します");
const adminSession = callbackTemplate.initialSessionId;
const activeSessionGeneration = vm.runInContext("FAMILY_WEBAPP_SESSION_GENERATION_", context);
const sessionPropertyKey = (sessionId) => "FAMILY_WEBAPP_SESSION_" + createHash("sha256").update(sessionId, "utf8").digest("hex");
const adminSessionProperty = JSON.parse(propertyValues[sessionPropertyKey(adminSession)]);
assert.deepEqual(Object.keys(adminSessionProperty).sort(), ["createdAt", "email", "generation"], "サーバー側にはメール、世代、作成時刻だけを保存します");
assert.equal(adminSessionProperty.email, "admin@example.com");
assert.notEqual(adminSessionProperty.email, effectiveUserEmail, "アプリ認証には実行アカウントではなくIDトークンとUsers照合の結果を使います");
assert.equal(adminSessionProperty.generation, activeSessionGeneration, "Code.gsの現在のデプロイ世代をセッション記録へ保存します");
assert.equal(JSON.stringify(propertyValues).includes(adminSession), false, "Script Propertiesへ生のセッション値を保存しません");
assert.equal(JSON.stringify(callbackTemplate).includes(callbackIdToken), false, "画面へGoogle IDトークンを出しません");
assert.equal(JSON.stringify(propertyValues).includes("未使用アクセストークン"), false, "アクセストークンをScript Propertiesへ保存しません");
assert.equal(JSON.stringify(propertyValues).includes("未使用更新トークン"), false, "更新トークンをScript Propertiesへ保存しません");
assert.equal(JSON.stringify(loggedMessages).includes(adminSession), false, "セッションをApps Script実行ログへ出しません");
assert.equal(JSON.stringify(loggedMessages).includes("one-time-code"), false, "認証コードをApps Script実行ログへ出しません");
const memberSession = context.issueFamilySession_("member@example.com");
const disabledSession = context.issueFamilySession_("disabled@example.com");
assert.equal(callbackTemplate.loginMessage, "ログインを確認しています。");
assert.equal(tokenExchangeRequests.at(-1).url, "https://oauth2.googleapis.com/token", "認証コードをGoogleのトークンエンドポイントへ送ります");
assert.deepEqual(tokenExchangeRequests.at(-1).options.payload, {
  code: "one-time-code", client_id: clientId, client_secret: "test-client-secret",
  redirect_uri: "https://script.google.com/macros/d/1zhqVIRy5YKrDURd77Tl5I4Za4f-1kvGqyJbvwnesW1HLFt8j7InXa3sQ/usercallback",
  grant_type: "authorization_code",
}, "コード交換ではサーバー側のシークレットと同じredirect URIを使います");
assert.equal(callbackTemplate.loginUrl.includes("test-client-secret"), false, "画面へシークレットを渡しません");
assert.equal(JSON.stringify(callbackTemplate).includes("未使用アクセストークン"), false, "アクセストークンを保存・画面出力しません");
assert.equal(JSON.stringify(callbackTemplate).includes("未使用更新トークン"), false, "更新トークンを保存・画面出力しません");
assert.equal(JSON.stringify(callbackTemplate).includes("one-time-code"), false, "認証コードを画面へ出しません");

context.doGet();
const mismatchNonce = stateTokens.at(-1).arguments.nonce;
oauthTokenResponse = JSON.stringify({ id_token: makeToken("admin@example.com", { nonce: "別のログイン要求" }) });
context.authCallback({ parameter: { code: "nonce-mismatch-code", nonce: mismatchNonce } });
assert.match(renderedTemplates.at(-1).loginMessage, /nonceが一致しません/, "state tokenのnonceとIDトークンのnonceが異なる応答を拒否します");
assert.equal(renderedTemplates.at(-1).initialSessionId, "", "nonce不一致時はアプリセッションを発行しません");
assert.ok(loggedMessages.includes("authCallback: IDトークンの検証に失敗しました。"), "nonce不一致をIDトークン段階の失敗として記録します");

context.doGet();
const deniedNonce = stateTokens.at(-1).arguments.nonce;
oauthTokenResponse = JSON.stringify({ id_token: makeToken("unknown@example.com", { nonce: deniedNonce }) });
context.authCallback({ parameter: { code: "unlisted-user-code", nonce: deniedNonce } });
assert.match(renderedTemplates.at(-1).loginMessage, /利用を許可されていません/, "IDトークン確認後にUsers許可リストを照合します");
assert.equal(renderedTemplates.at(-1).initialSessionId, "", "許可されていない利用者へアプリセッションを発行しません");
assert.ok(loggedMessages.includes("authCallback: Usersシートの利用許可確認に失敗しました。"), "Users拒否を段階ログで区別します");

const exchangesBeforeMissingNonce = tokenExchangeRequests.length;
context.authCallback({ parameter: { code: "missing-nonce-code" } });
assert.equal(tokenExchangeRequests.length, exchangesBeforeMissingNonce, "nonceがないcallbackではコード交換を開始しません");
assert.match(renderedTemplates.at(-1).loginMessage, /要求を確認できません/);
assert.ok(loggedMessages.includes("authCallback: コールバック要求の確認に失敗しました。"), "入力不備を段階ログで区別します");

context.doGet();
const exchangeFailureNonce = stateTokens.at(-1).arguments.nonce;
context.authCallback({ parameter: { code: "exchange-failure", nonce: exchangeFailureNonce } });
assert.match(renderedTemplates.at(-1).loginMessage, /認証コード交換に失敗しました/);
assert.equal(JSON.stringify(renderedTemplates.at(-1)).includes("exchange-failure"), false, "コード交換失敗時に認証コードを出力しません");
assert.ok(loggedMessages.includes("authCallback: 認証コードの交換に失敗しました。"), "交換失敗を段階ログで区別します");

expectError(() => context.getAppData(""), "アプリのログイン状態が無効");
expectError(() => context.getAppData(callbackIdToken), "アプリのログイン状態が無効");
expectError(() => context.getAppData(context.issueFamilySession_("unknown@example.com")), "利用を許可されていません");
expectError(() => context.getAppData(disabledSession), "利用を許可されていません");
expectError(() => context.verifyGoogleIdToken_(makeToken("admin@example.com", { aud: "other-client" })), "宛先が正しくありません");
expectError(() => context.verifyGoogleIdToken_(makeToken("admin@example.com", { exp: 1 })), "有効期限が切れています");
expectError(() => context.verifyGoogleIdToken_(makeToken("admin@example.com", {}, true)), "署名を確認できません");
expectError(() => context.verifyGoogleIdToken_(makeToken("admin@example.com", { email_verified: false })), "確認済み");
expectError(() => context.initializeFamilyLedger(memberSession), "管理者だけ");

const beforeSetup = plain(context.getAppData(adminSession));
assert.equal(beforeSetup.setupRequired, true, "未初期化のシート状態を管理者へ案内します");
const legacyRequests = spreadsheet.insertSheet("Requests");
const legacyHeaders = ["requestId", "operation", "recordId", "requestHash", "resultJson", "createdAt"];
const legacyRequestRow = ["legacy-request-1", "expense", "legacy-expense", "a".repeat(64), '{"id":"legacy-expense"}', "2026-09-01T00:00:00.000Z"];
legacyRequests.appendRow(legacyHeaders);
legacyRequests.appendRow(legacyRequestRow);
const initialized = plain(context.initializeFamilyLedger(adminSession));
assert.equal(initialized.setupRequired, false);
assert.deepEqual(legacyRequests.rows[0], ["requestId", "operation", "recordId", "requestHash", "resultJson", "createdAt", "status", "targetRecordId", "previousStateHash", "updatedAt", "payloadJson"], "旧Requests見出しは列追加形式で安全に移行します");
assert.deepEqual(legacyRequests.rows[1].slice(0, legacyHeaders.length), legacyRequestRow, "旧Requests行の既存値を維持します");
assert.deepEqual(legacyRequests.getRange(2, legacyHeaders.length + 1, 1, 5).getValues()[0], ["", "", "", "", ""], "追加したjournal列は空欄から開始します");
const interimRequests = new MemorySheet("Requests-interim");
const interimHeaders = ["requestId", "operation", "recordId", "requestHash", "resultJson", "createdAt", "status", "targetRecordId", "previousStateHash", "updatedAt"];
interimRequests.appendRow(interimHeaders);
interimRequests.appendRow(["interim-request-1", "expense", "interim-expense", "b".repeat(64), "{}", "2026-09-02T00:00:00.000Z", "pending", "expense-1", "c".repeat(64), "2026-09-02T00:01:00.000Z"]);
context.ensureRequestsSchemaUnlocked_(interimRequests);
assert.deepEqual(interimRequests.rows[0], [...interimHeaders, "payloadJson"], "中間journal見出しにもpayload列を末尾追加します");
assert.deepEqual(interimRequests.rows[1].slice(0, interimHeaders.length), ["interim-request-1", "expense", "interim-expense", "b".repeat(64), "{}", "2026-09-02T00:00:00.000Z", "pending", "expense-1", "c".repeat(64), "2026-09-02T00:01:00.000Z"], "中間Requests行の既存値を維持します");
assert.deepEqual(initialized.members.map((row) => row.name), ["自分", "パートナー", "共通／家族"]);
assert.equal(initialized.sources.find((row) => row.id === "source-partner-cash").walletEnabled, true);
assert.equal(initialized.sources.find((row) => row.id === "source-family-card").walletEnabled, false);
const usersSheetForRoleTest = spreadsheet.getSheetByName("Users");
const usersRowsBeforeRoleTest = usersSheetForRoleTest.rows.map((row) => [...row]);
context.saveUser(adminSession, { email: "temporary-admin@example.com", name: "一時管理者", role: "admin", defaultMemberId: "member-self", active: true });
context.saveUser(adminSession, { originalEmail: "admin@example.com", email: "admin@example.com", name: "管理者", role: "member", defaultMemberId: "member-self", active: true });
assert.equal(plain(context.getAppData(adminSession)).user.role, "member", "同じセッションでもUsersシートの変更後ロールを読み直します");
expectError(() => context.saveBudget(adminSession, 123), "管理者だけ");
usersSheetForRoleTest.rows = usersRowsBeforeRoleTest;
assert.equal(plain(context.getAppData(adminSession)).user.role, "admin", "ロール確認後にテスト用Usersデータを元へ戻します");
const newWallet = plain(context.saveMaster(adminSession, "sources", { name: "封筒現金", walletEnabled: true, openingBalance: 2500 }));
assert.equal(plain(context.getAppData(adminSession)).sources.find((row) => row.id === newWallet.id).balance, 2500, "支払元の初期残高を財布へ加算します");
const invalidTopUp = { requestId: "wallet-validation-repair", sourceId: newWallet.id, date: "2026-09-01", amount: 0, memo: "入力修正" };
expectError(() => context.addWalletTopUp(adminSession, invalidTopUp), "補充額は1円以上");
const validTopUpAfterValidation = plain(context.addWalletTopUp(adminSession, { ...invalidTopUp, amount: 7 }));
assert.equal(validTopUpAfterValidation.amount, 7, "未保存の補充バリデーション失敗後は同じ要求IDで修正値を保存できます");
assert.equal(spreadsheet.getSheetByName("WalletHistory").rows.filter((row) => row[8] === invalidTopUp.requestId).length, 1, "補充バリデーション修正後は一件だけ保存します");
const openingRaceSource = "source-opening-race";
const openingCountBefore = spreadsheet.getSheetByName("WalletHistory").getLastRow();
onRangeRead = (sheetName) => {
  if (sheetName !== "WalletHistory") return false;
  expectError(() => context.ensureOpeningWalletEntry_({ id: "opening-race-2", sourceId: openingRaceSource, type: "opening", amount: 900, date: "2026-09-01" }), "別の保存処理");
  return true;
};
context.ensureOpeningWalletEntry_({ id: "opening-race-1", sourceId: openingRaceSource, type: "opening", amount: 100, date: "2026-09-01" });
assert.equal(spreadsheet.getSheetByName("WalletHistory").getLastRow(), openingCountBefore + 1, "同時の初期残高登録は一方だけがロックを取得できます");

expectError(() => context.saveMaster(memberSession, "categories", { name: "臨時" }), "管理者だけ");
const invalidExpense = { requestId: "expense-validation-repair", date: "2026-09-01", amount: 900, memberId: "missing", sourceId: "source-partner-cash", categoryId: "category-1" };
expectError(() => context.saveExpense(memberSession, invalidExpense), "利用者を選び直してください");
const validExpenseAfterValidation = plain(context.saveExpense(memberSession, { ...invalidExpense, memberId: "member-self" }));
assert.equal(validExpenseAfterValidation.amount, 900, "未保存の支出バリデーション失敗後は同じ要求IDで修正値を保存できます");
assert.equal(spreadsheet.getSheetByName("Expenses").rows.filter((row) => row[12] === invalidExpense.requestId).length, 1, "支出バリデーション修正後は一件だけ保存します");
context.deleteExpense(memberSession, validExpenseAfterValidation.id);
expectError(() => context.saveMaster(adminSession, "categories", { name: "収入" }), "収入カテゴリ");

const firstTopUp = { requestId: "wallet-request-1", sourceId: "source-partner-cash", date: "2026-08-01", amount: 10000, memo: "初回補充" };
onRangeRead = (sheetName) => {
  if (sheetName !== "Requests") return false;
  expectError(() => context.addWalletTopUp(adminSession, firstTopUp), "別の保存処理");
  return true;
};
const pendingWriteFailure = { requestId: "wallet-pending-write", sourceId: "source-partner-cash", date: "2026-08-02", amount: 100, memo: "pending境界" };
failNextRequestPendingWrite = true;
expectError(() => context.addWalletTopUp(adminSession, pendingWriteFailure), "pending要求記録");
assert.equal(spreadsheet.getSheetByName("WalletHistory").rows.filter((row) => row[8] === pendingWriteFailure.requestId).length, 0, "pending記録失敗時は財布台帳を変更しません");
assert.equal(spreadsheet.getSheetByName("Requests").rows.filter((row) => row[0] === pendingWriteFailure.requestId).length, 0, "pending記録失敗時は要求行も残しません");
const pendingFailureRecovered = plain(context.addWalletTopUp(adminSession, pendingWriteFailure));
assert.equal(pendingFailureRecovered.amount, 100, "pending記録失敗後の再送を安全に実行します");
const ledgerWriteFailure = { requestId: "wallet-ledger-write", sourceId: "source-partner-cash", date: "2026-08-03", amount: 200, memo: "台帳境界" };
failNextLedgerWrite = true;
expectError(() => context.addWalletTopUp(adminSession, ledgerWriteFailure), "台帳行の試験書き込み");
assert.equal(spreadsheet.getSheetByName("Requests").rows.find((row) => row[0] === ledgerWriteFailure.requestId)[6], "pending", "台帳書き込み失敗時はpending journalを残します");
const ledgerFailureRecovered = plain(context.addWalletTopUp(adminSession, ledgerWriteFailure));
assert.equal(ledgerFailureRecovered.amount, 200, "pending journalから未適用の財布補充を安全に再実行します");
assert.equal(spreadsheet.getSheetByName("WalletHistory").rows.filter((row) => row[8] === ledgerWriteFailure.requestId).length, 1, "台帳書き込み失敗後の再送は一件だけ保存します");
failNextRequestCompletion = true;
expectError(() => context.addWalletTopUp(adminSession, firstTopUp), "完了要求記録の試験書き込み");
assert.equal(spreadsheet.getSheetByName("Requests").rows.find((row) => row[0] === firstTopUp.requestId)[6], "pending", "完了記録失敗時はpending journalを維持します");
expectError(() => context.addWalletTopUp(adminSession, { ...firstTopUp, amount: 11000 }), "異なる内容");
const firstTopUpSaved = plain(context.addWalletTopUp(adminSession, firstTopUp));
const firstTopUpResent = plain(context.addWalletTopUp(adminSession, firstTopUp));
assert.equal(firstTopUpResent.id, firstTopUpSaved.id, "同じ補充要求の再送には同じ結果を返します");
assert.equal(firstTopUpSaved.amount, 10000, "Requests記録の失敗後も元の補充額を保持します");
assert.equal(spreadsheet.getSheetByName("WalletHistory").rows.filter((row) => row[8] === firstTopUp.requestId).length, 1, "補充の再送で財布履歴を二重登録しません");
assert.match(spreadsheet.getSheetByName("WalletHistory").rows.find((row) => row[8] === firstTopUp.requestId)[9], /^[0-9a-f]{64}$/, "財布履歴にも要求内容ハッシュを保存します");
assert.match(spreadsheet.getSheetByName("Requests").rows.find((row) => row[0] === firstTopUp.requestId)[3], /^[0-9a-f]{64}$/, "要求台帳にSHA-256ハッシュを保存します");
assert.equal(spreadsheet.getSheetByName("Requests").rows.find((row) => row[0] === firstTopUp.requestId)[6], "complete", "補充の同一payload再送でpendingを完了にします");
expectError(() => context.addWalletTopUp(adminSession, { ...firstTopUp, amount: 12000 }), "異なる内容");
expectError(() => context.saveExpense(memberSession, {
  requestId: firstTopUp.requestId, date: "2026-09-02", amount: 100, memberId: "member-self", sourceId: "source-family-card", categoryId: "category-1",
}), "別の操作");
context.addWalletTopUp(adminSession, { requestId: "wallet-request-2", sourceId: "source-partner-cash", date: "2026-09-01", amount: 5000, memo: "追加補充" });
expectError(() => context.addWalletTopUp(memberSession, { sourceId: "source-partner-cash", date: "2026-09-01", amount: 1 }), "管理者だけ");
const expensePayload = {
  requestId: "expense-request-1",
  date: "2026-09-02", amount: 1250, memberId: "member-partner", sourceId: "source-partner-cash",
  categoryId: "category-1", placeId: "place-1", memo: "=IMPORTXML(\"https://example.invalid\",\"//x\")",
};
failNextRequestCompletion = true;
expectError(() => context.saveExpense(memberSession, expensePayload), "完了要求記録の試験書き込み");
expectError(() => context.saveExpense(memberSession, { ...expensePayload, amount: 1500 }), "異なる内容");
assert.equal(plain(context.getAppData(memberSession)).expenses[0].amount, 1250, "異なる内容での再送拒否後も元の支出額を保持します");
const created = plain(context.saveExpense(memberSession, expensePayload));
assert.equal(created.createdBy, "member@example.com");
assert.equal(created.memberId, "member-partner");
assert.equal(created.sourceId, "source-partner-cash");
assert.equal(created.memo, "=IMPORTXML(\"https://example.invalid\",\"//x\")", "数式形式のメモも文字列のまま保持します");
assert.ok(spreadsheet.getSheetByName("Expenses").richTextWrites > 0, "数式形式の文字列をリッチテキストとして保存します");
const createdAgain = plain(context.saveExpense(memberSession, {
  ...expensePayload,
}));
assert.equal(createdAgain.id, created.id, "同じ支出要求の再送には同じ結果を返します");
assert.equal(spreadsheet.getSheetByName("Expenses").getLastRow(), 2, "支出の再送で二重登録しません");
assert.match(spreadsheet.getSheetByName("Expenses").rows[1][13], /^[0-9a-f]{64}$/, "支出行にも要求内容ハッシュを保存します");
expectError(() => context.saveExpense(memberSession, { ...expensePayload, memo: "異なる内容" }), "異なる内容");
assert.equal(plain(context.getAppData(memberSession)).expenses[0].memo, created.memo, "シートから元の数式形式の文字列を読み戻せます");
let appData = plain(context.getAppData(memberSession));
assert.equal(appData.sources.find((row) => row.id === "source-partner-cash").balance, 14050);
assert.equal(appData.expenses.reduce((sum, row) => sum + Number(row.amount), 0), 1250, "財布補充は支出合計に混ざりません");
assert.equal(appData.users.length, 0, "一般ユーザーはユーザー管理情報を受け取りません");

const pendingLedgerExpenseUpdate = { ...created, requestId: "expense-update-ledger-failure", date: "2026-10-02", amount: 220, memberId: "member-self", sourceId: "source-family-card", categoryId: "category-2", placeId: "", memo: "再読込で回復" };
failNextLedgerWrite = true;
expectError(() => context.saveExpense(memberSession, pendingLedgerExpenseUpdate), "台帳行の試験書き込み");
assert.equal(spreadsheet.getSheetByName("Requests").rows.find((row) => row[0] === pendingLedgerExpenseUpdate.requestId)[10] !== "", true, "pending journalに正規化済み支出payloadを保存します");
assert.equal(spreadsheet.getSheetByName("Expenses").rows.find((row) => row[0] === created.id)[5], 1250, "台帳書き込み失敗時は既存支出を変更しません");
assert.equal(spreadsheet.getSheetByName("Requests").rows.find((row) => row[0] === pendingLedgerExpenseUpdate.requestId)[6], "pending", "台帳書き込み失敗で要求をpendingに保ちます");
appData = plain(context.getAppData(memberSession));
const reloadedExpense = appData.expenses.find((row) => row.id === created.id);
assert.equal(reloadedExpense.amount, 220, "getAppDataで保留中の支出payloadを再適用します");
assert.equal(reloadedExpense.date, pendingLedgerExpenseUpdate.date, "再読込回復で保留中の日付を復元します");
assert.equal(reloadedExpense.memberId, pendingLedgerExpenseUpdate.memberId, "再読込回復で保留中の利用者を復元します");
assert.equal(reloadedExpense.sourceId, pendingLedgerExpenseUpdate.sourceId, "再読込回復で保留中の支払元を復元します");
assert.equal(reloadedExpense.memo, pendingLedgerExpenseUpdate.memo, "再読込回復で保留中のメモを復元します");
assert.equal(reloadedExpense.requestId, pendingLedgerExpenseUpdate.requestId, "再読込回復後に元の要求IDを台帳へ保存します");
assert.equal(spreadsheet.getSheetByName("Requests").rows.find((row) => row[0] === pendingLedgerExpenseUpdate.requestId)[6], "complete", "再読込回復でpending journalを完了します");

const pendingExpenseUpdate = { ...created, requestId: "expense-update-pending-1", date: "2026-10-03", amount: 250, memberId: "member-family", sourceId: "source-family-card", categoryId: "category-2", placeId: "", memo: "未確定更新" };
failNextRequestCompletion = true;
expectError(() => context.saveExpense(memberSession, pendingExpenseUpdate), "完了要求記録の試験書き込み");
const pendingExpenseRequest = spreadsheet.getSheetByName("Requests").rows.find((row) => row[0] === pendingExpenseUpdate.requestId);
assert.equal(pendingExpenseRequest[6], "pending", "支出更新の完了記録失敗時は更新intentをpendingのまま残します");
const updatedExpenseRow = spreadsheet.getSheetByName("Expenses").rows.find((row) => row[0] === created.id);
assert.equal(updatedExpenseRow[5], 250, "支出台帳の更新自体は完了しています");
assert.equal(updatedExpenseRow[12], pendingExpenseUpdate.requestId, "支出行に未確定更新の要求IDを保持します");
expectError(() => context.deleteExpense(memberSession, created.id), "結果未確定の保存要求");
const conflictingExpenseUpdate = { ...pendingExpenseUpdate, requestId: "expense-update-pending-2", amount: 300, memo: "競合する更新" };
expectError(() => context.saveExpense(memberSession, conflictingExpenseUpdate), "前回の支出更新を復旧しました");
assert.equal(spreadsheet.getSheetByName("Requests").rows.find((row) => row[0] === pendingExpenseUpdate.requestId)[6], "complete", "同一支出への次の操作前に前pendingを回復して完了します");
assert.equal(spreadsheet.getSheetByName("Expenses").rows.find((row) => row[0] === created.id)[5], 250, "pending中の別要求で支出を上書きしません");
const recoveredExpenseUpdate = plain(context.saveExpense(memberSession, pendingExpenseUpdate));
assert.equal(recoveredExpenseUpdate.amount, 250, "元要求の再送は台帳に適用済みの値を回復します");
assert.equal(spreadsheet.getSheetByName("Requests").rows.find((row) => row[0] === pendingExpenseUpdate.requestId)[6], "complete", "支出の同一要求再送でjournalを完了にします");
assert.equal(spreadsheet.getSheetByName("Expenses").rows.find((row) => row[0] === created.id)[5], 250, "元要求の回復後に台帳値を維持します");
appData = plain(context.getAppData(memberSession));
assert.equal(appData.expenses[0].memberId, "member-family");
assert.equal(appData.expenses[0].sourceId, "source-family-card", "利用者と支払元を別々に保存します");
assert.equal(appData.sources.find((row) => row.id === "source-partner-cash").balance, 15300, "他の支払元の支出は財布残高に含みません");
context.deleteExpense(memberSession, created.id);
assert.equal(plain(context.getAppData(memberSession)).expenses.length, 0);

context.saveUser(adminSession, { email: "member@example.com", name: "利用者", role: "member", defaultMemberId: "member-partner", active: false });
expectError(() => context.getAppData(memberSession), "利用を許可されていません");
context.saveUser(adminSession, { email: "member@example.com", name: "利用者", role: "member", defaultMemberId: "member-partner", active: true });
assert.equal(plain(context.getAppData(memberSession)).user.email, "member@example.com", "再有効化後も保存済みのブラウザーセッションを再確認します");

context.saveUser(adminSession, { originalEmail: "member@example.com", email: "renamed-member@example.com", name: "名前変更", role: "member", defaultMemberId: "member-partner", active: true });
expectError(() => context.getAppData(memberSession), "利用を許可されていません");
const renamedSession = context.issueFamilySession_("renamed-member@example.com");
assert.equal(plain(context.getAppData(renamedSession)).user.email, "renamed-member@example.com", "変更後メールだけを許可します");
assert.equal(spreadsheet.getSheetByName("Users").getLastRow(), 4, "メール変更時もユーザー行を追加せず更新します");

context.saveBudget(adminSession, 250000);
context.saveSettingRecord(adminSession, "fixedCosts", { name: "住宅費", amount: 90000, day: 25, frequency: "monthly", categoryId: "category-6", sourceId: "source-family-card", placeId: "place-3", note: "" });
context.saveSettingRecord(adminSession, "emailRules", { conditionType: "subject", condition: "カード利用通知", sourceId: "source-family-card", categoryId: "category-1", placeId: "place-2" });
appData = plain(context.getAppData(adminSession));
assert.equal(appData.budget.amount, 250000);
assert.equal(appData.fixedCosts[0].name, "住宅費");
assert.equal(appData.emailRules[0].condition, "カード利用通知");
context.initializeFamilyLedger(adminSession);
assert.equal(plain(context.getAppData(adminSession)).fixedCosts.length, 1, "再初期化で既存設定を消しません");

const oldApplied = plain(context.saveExpense(adminSession, { requestId: "legacy-applied-seed", date: "2026-09-10", amount: 101, memberId: "member-self", sourceId: "source-family-card", categoryId: "category-1", memo: "旧applied" }));
const oldBaseline = plain(context.saveExpense(adminSession, { requestId: "legacy-baseline-seed", date: "2026-09-11", amount: 202, memberId: "member-self", sourceId: "source-family-card", categoryId: "category-1", memo: "旧baseline" }));
const oldConflict = plain(context.saveExpense(adminSession, { requestId: "legacy-conflict-seed", date: "2026-09-12", amount: 303, memberId: "member-self", sourceId: "source-family-card", categoryId: "category-1", memo: "旧conflict" }));
const unrelatedExpense = plain(context.saveExpense(adminSession, { requestId: "legacy-unrelated-seed", date: "2026-09-13", amount: 404, memberId: "member-self", sourceId: "source-family-card", categoryId: "category-1", memo: "対象外" }));
const oldAppliedRequestId = "legacy10-applied-update";
const oldAppliedRequestHash = "a".repeat(64);
context.writeTableRecord_("expenses", { ...oldApplied, requestId: oldAppliedRequestId, requestHash: oldAppliedRequestHash });
const requestsForLegacy = spreadsheet.getSheetByName("Requests");
requestsForLegacy.rows[0] = [...interimHeaders];
requestsForLegacy.rows.slice(1).forEach((row) => { row.length = interimHeaders.length; });
requestsForLegacy.appendRow([oldAppliedRequestId, "expense", "", oldAppliedRequestHash, "", "2026-09-14T00:00:00.000Z", "pending", oldApplied.id, "0".repeat(64), "2026-09-14T00:01:00.000Z"]);
requestsForLegacy.appendRow(["legacy10-baseline-update", "expense", "", "b".repeat(64), "", "2026-09-14T00:00:00.000Z", "pending", oldBaseline.id, context.expenseRecordStateHash_(oldBaseline), "2026-09-14T00:01:00.000Z"]);
requestsForLegacy.appendRow(["legacy10-conflicting-update", "expense", "", "c".repeat(64), "", "2026-09-14T00:00:00.000Z", "pending", oldConflict.id, "f".repeat(64), "2026-09-14T00:01:00.000Z"]);
appData = plain(context.getAppData(adminSession));
assert.equal(appData.expenses.length, 4, "空payloadの旧pendingがあってもgetAppDataは他の台帳データを返します");
assert.deepEqual(requestsForLegacy.rows[0], [...interimHeaders, "payloadJson"], "旧10列Requestsをpending回復前にpayload列付きへ移行します");
assert.equal(requestsForLegacy.rows.find((row) => row[0] === oldAppliedRequestId)[6], "complete", "台帳行のrequestId/hashが一致する旧pendingを完了扱いにします");
assert.equal(requestsForLegacy.rows.find((row) => row[0] === "legacy10-baseline-update")[6], "notApplied", "元状態hashが一致するpayloadなし更新を未適用として終了します");
assert.equal(requestsForLegacy.rows.find((row) => row[0] === "legacy10-conflicting-update")[6], "needsReview", "元状態hashが異なる旧更新を確認待ちに隔離します");
const baselineRecovery = plain(context.saveExpense(adminSession, { ...oldBaseline, requestId: "legacy-baseline-new-operation", amount: 212, memo: "baseline後の新操作" }));
assert.equal(baselineRecovery.amount, 212, "notAppliedへ隔離後は新しい要求IDで更新できます");
expectError(() => context.saveExpense(adminSession, { ...oldConflict, requestId: "legacy-conflict-new-operation", amount: 313 }), "確認が必要な旧保存要求");
expectError(() => context.deleteExpense(adminSession, oldConflict.id), "確認が必要な旧保存要求");
const unrelatedUpdate = plain(context.saveExpense(adminSession, { ...unrelatedExpense, requestId: "legacy-unrelated-new-operation", amount: 414 }));
assert.equal(unrelatedUpdate.amount, 414, "needsReviewは対象外の支出操作を妨げません");
assert.equal(plain(context.getAppData(adminSession)).expenses.length, 4, "needsReview行が残っても再読込は成功します");

const backup = [
  ["id", "date", "payer", "category", "amount", "memo", "place", "createdBy", "createdAt", "updatedAt", "visibility"],
  ["p1", "2025-01-01", "パートナー現金", "食費", 1200, "公開", "店", "partner@example.com", "created", "updated", "public"],
  ["p2", "2025-01-02", "家族カード", "日用品", 800, "空欄", "店", "webhook", "created", "updated", ""],
  ["s1", "2025-01-03", "現金", "食費", 100, "集計", "", "api", "", "", "summary"],
  ["v1", "2025-01-04", "現金", "食費", 100, "非公開", "", "api", "", "", "private"],
  ["i1", "2025-01-05", "銀行", "収入", 300000, "給与", "会社", "api", "", "", "public"],
  ["c1", "2025-01-06", "現金", "現金チャージ", 5000, "チャージ", "ATM", "api", "", "", "public"],
  ["u1", "2025-01-07", "現金", "食費", 200, "大文字", "店", "api", "", "", "PUBLIC"],
  ["z0", "2025-01-08", "現金", "食費", 200, "数値", "店", "api", "", "", 0],
  ["zf", "2025-01-09", "現金", "食費", 200, "真偽値", "店", "api", "", "", false],
  ["zn", "2025-01-10", "現金", "食費", 200, "null空欄", "店", "api", "", "", null],
  ["zu", "2025-01-11", "現金", "食費", 200, "undefined空欄", "店", "api", "", "", undefined],
  ["zs", "2025-01-12", "現金", "食費", 200, "空白", "店", "api", "", "", " "],
];
const migration = plain(context.transformLegacyBackupRows_(backup, ["現金チャージ"]));
assert.deepEqual(migration.rows.map((row) => row.id), ["p1", "p2", "zn", "zu"]);
assert.equal(migration.rows[0].legacyPayer, "パートナー現金");
assert.equal(migration.rows[0].memberName, "自分");
assert.equal(migration.rows[0].createdBy, "partner@example.com", "createdByは由来情報として保持します");
assert.equal(migration.skippedVisibility, 6);
assert.equal(migration.skippedIncome, 1);
assert.equal(migration.skippedNonExpense, 2);
expectError(() => context.transformLegacyBackupRows_([backup[0].slice(0, 10)]), "列見出し");
const expenseSheet = spreadsheet.getSheetByName("Expenses");
const expenseHeader = [...expenseSheet.rows[0]];
expenseSheet.rows[0][2] = "不正な列";
expectError(() => context.getAppData(adminSession), "列見出し");
expenseSheet.rows[0] = expenseHeader;

const logoutSession = context.issueFamilySession_("admin@example.com");
const logoutSessionKey = sessionPropertyKey(logoutSession);
assert.equal(context.logoutFamilySession(logoutSession).loggedOut, true, "ログアウト操作はサーバー側の失効を完了します");
assert.equal(propertyValues[logoutSessionKey], undefined, "ログアウト時にハッシュ化したセッション記録を削除します");
expectError(() => context.getAppData(logoutSession), "アプリのログイン状態が無効");

const disabledLogoutSession = context.issueFamilySession_("renamed-member@example.com");
const disabledLogoutSessionKey = sessionPropertyKey(disabledLogoutSession);
context.saveUser(adminSession, { originalEmail: "renamed-member@example.com", email: "renamed-member@example.com", name: "名前変更", role: "member", defaultMemberId: "member-partner", active: false });
expectError(() => context.logoutFamilySession(disabledLogoutSession), "利用を許可されていません");
assert.equal(propertyValues[disabledLogoutSessionKey], undefined, "利用停止ユーザーのログアウトもサーバー記録を失効させます");

const staleGenerationSession = "f".repeat(96);
const staleGenerationKey = sessionPropertyKey(staleGenerationSession);
propertyValues[staleGenerationKey] = JSON.stringify({ email: "admin@example.com", generation: "previous-" + activeSessionGeneration, createdAt: "2026-09-27T00:00:00.000Z" });
expectError(() => context.getAppData(staleGenerationSession), "アプリのログイン状態が無効");
assert.equal(propertyValues[staleGenerationKey], undefined, "世代が古いセッションを操作前に拒否して削除します");

const obsoleteSession = "e".repeat(96);
const obsoleteSessionKey = sessionPropertyKey(obsoleteSession);
propertyValues[obsoleteSessionKey] = JSON.stringify({ email: "admin@example.com", generation: "previous-" + activeSessionGeneration, createdAt: "2026-09-27T00:00:00.000Z" });
const currentGenerationSession = context.issueFamilySession_("admin@example.com");
assert.equal(propertyValues[obsoleteSessionKey], undefined, "新規ログイン時に旧世代の記録を整理します");
assert.equal(plain(context.getAppData(currentGenerationSession)).user.email, "admin@example.com", "現在世代のセッションで認証できます");

const sensitiveLogValues = [
  propertyValues.GOOGLE_OAUTH_CLIENT_SECRET, effectiveUserEmail, "owner-only@example.net",
  "admin@example.com", "member@example.com", "disabled@example.com", "unknown@example.com",
  "one-time-code", "nonce-mismatch-code", "unlisted-user-code", "missing-nonce-code", "exchange-failure",
  callbackNonce, mismatchNonce, deniedNonce, exchangeFailureNonce, callbackIdToken,
  adminSession, memberSession, disabledSession, logoutSession, disabledLogoutSession,
  staleGenerationSession, obsoleteSession, currentGenerationSession,
  ...stateTokens.map((_token, index) => `state-token-${index + 1}`),
];
const executionLogs = loggedMessages.join("\n");
for (const sensitiveValue of sensitiveLogValues) {
  if (sensitiveValue) assert.equal(executionLogs.includes(sensitiveValue), false, "実行ログに機密値を含めません");
}

console.log("バックエンド確認: 認証・権限・シート保存・財布残高・バックアップ抽出はすべて成功しました。");
