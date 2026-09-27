import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const checksDirectory = path.resolve(scriptDirectory, "..");
const projectDirectory = path.resolve(checksDirectory, "../webapp-pilot");
const cacheDirectory = path.resolve(checksDirectory, ".cache");
const screenshotDirectory = path.join(cacheDirectory, "screenshots");
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(cacheDirectory, "ms-playwright");
const localLibraryDirectory = path.join(cacheDirectory, "system-libs", "usr", "lib", "x86_64-linux-gnu");
process.env.LD_LIBRARY_PATH = [localLibraryDirectory, process.env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter);
const [indexHtml, stylesHtml, clientHtml, serverCode, appsscriptJson] = await Promise.all([
  readFile(path.join(projectDirectory, "Index.html"), "utf8"),
  readFile(path.join(projectDirectory, "Styles.html"), "utf8"),
  readFile(path.join(projectDirectory, "Client.html"), "utf8"),
  readFile(path.join(projectDirectory, "Code.gs"), "utf8"),
  readFile(path.join(projectDirectory, "appsscript.json"), "utf8"),
]);

assert.match(serverCode, /verifyGoogleSignature_/);
assert.match(serverCode, /verifyGoogleIdToken_/);
assert.match(serverCode, /authorizeSession_\(sessionId, false\)/);
assert.match(serverCode, /function googleOAuthClientId_\(\)\s*\{\s*return getScriptProperty_\('GOOGLE_OAUTH_CLIENT_ID', false\) \|\| FAMILY_WEB_OAUTH_CLIENT_ID_;?\s*\}/, "Script Property overrideと内蔵OAuth client ID fallbackを共通化します");
assert.match(serverCode, /function authCallback\(request\)/, "Apps Scriptのusercallbackで認証応答を処理します");
assert.match(serverCode, /ScriptApp\.newStateToken\(\)[\s\S]*?\.withMethod\('authCallback'\)[\s\S]*?\.withArgument\('nonce', nonce\)/, "State Tokenにcallback関数とnonceを結びます");
assert.match(serverCode, /function exchangeGoogleAuthorizationCode_\(authorizationCode\)/, "認証コードをサーバー側で交換します");
assert.match(serverCode, /verifyGoogleIdToken_\(idToken, String\(parameters\.nonce\)\)/, "IDトークンのnonceを照合します");
assert.match(serverCode, /FAMILY_WEB_OAUTH_REDIRECT_URI_ = 'https:\/\/script\.google\.com\/macros\/d\/1zhqVIRy5YKrDURd77Tl5I4Za4f-1kvGqyJbvwnesW1HLFt8j7InXa3sQ\/usercallback'/, "Cloud Consoleへ登録するコールバックURIを固定します");
assert.ok(serverCode.includes("getScriptProperty_('GOOGLE_OAUTH_CLIENT_SECRET', true)"), "OAuthクライアントシークレットをスクリプトプロパティから取得します");
assert.match(serverCode, /function verifyFamilyScriptPropertiesWriteAccess_\(properties\)[\s\S]*?properties\.setProperty\(propertyKey, probeValue\)[\s\S]*?properties\.deleteProperty\(propertyKey\)/, "サービス承認確認では一時プロパティの保存と削除を実行します");
assert.match(serverCode, /function authorizeFamilyLedgerServices_\(\)\s*\{\s*ScriptApp\.requireAllScopes\(ScriptApp\.AuthMode\.FULL\);\s*const effectiveUserEmail = Session\.getEffectiveUser\(\)\.getEmail\(\);/, "承認ヘルパーは全スコープと実行アカウントを最初に確認します");
const authorizationHelper = serverCode.match(/function authorizeFamilyLedgerServices_\(\)\s*\{([\s\S]*?)\n\}\n\nfunction verifyFamilyScriptPropertiesWriteAccess_/)?.[1] || "";
assert.doesNotMatch(authorizationHelper, /authorizeClaims_|authorizeSession_|issueFamilySession_|Users/, "実行アカウント情報をログイン認証へ流用しません");
assert.match(serverCode, /function authCallbackFailureLogMessage_\(stage\)/, "callbackの失敗段階を固定ログ文言へ変換します");
assert.match(serverCode, /doGet: 画面要求を受け付けました。[\s\S]*?doGet: ログイン画面を生成します。/, "doGetの開始段階を記録します");
assert.ok(serverCode.includes("971274774993-0qpfrqc5i8ct48kq5r2sb7sa7h5s4pou.apps.googleusercontent.com"), "提供されたOAuth client IDを内蔵fallbackへ設定します");
assert.match(appsscriptJson, /"access":\s*"MYSELF"/, "OAuth設定未確認のためアクセス制限を維持します");
const declaredScopes = JSON.parse(appsscriptJson).oauthScopes;
assert.ok(declaredScopes.includes("https://www.googleapis.com/auth/script.storage"), "Script Propertiesの読書きに必要なスコープを含めます");
assert.ok(declaredScopes.includes("https://www.googleapis.com/auth/userinfo.email"), "Apps Scriptの実行アカウント確認用スコープを宣言します");
assert.match(indexHtml, /id="google-login-link" href="<\?= loginUrl \?>" target="_top"/);
assert.match(indexHtml, /id="auth-bootstrap" data-session-id="<\?= initialSessionId \?>"/);
assert.ok(!/gis\/client|google\.accounts\.id|origin-diagnostic|debugOrigin/.test(indexHtml + clientHtml + serverCode), "GISとオリジン診断の実装を削除します");
const sampleLoginUrl = "https://accounts.google.com/o/oauth2/v2/auth?client_id=local-client.apps.googleusercontent.com&redirect_uri=" + encodeURIComponent("https://script.google.com/macros/d/1zhqVIRy5YKrDURd77Tl5I4Za4f-1kvGqyJbvwnesW1HLFt8j7InXa3sQ/usercallback") + "&response_type=code&scope=openid%20email&state=local-state-token&nonce=local-one-time-nonce";
const previewTemplate = indexHtml
  .replace("<?!= include('Styles'); ?>", () => stylesHtml)
  .replace("<?!= include('Client'); ?>", () => clientHtml)
  .replace('<?= loginUrl ?>', sampleLoginUrl)
  .replace("<?= loginUrl ? 'true' : 'false' ?>", 'true')
  .replace('<?= loginMessage ?>', '登録済みのGoogleアカウントでログインしてください。')
  .replace('<?= initialSessionId ?>', 'ローカル確認用セッション')
  .replace('<?= deploymentGeneration ?>', '確認用世代');
const previewHtml = previewTemplate;
const loginPreviewHtml = previewTemplate.replace('data-session-id="ローカル確認用セッション"', 'data-session-id=""');
assert.ok(!previewHtml.includes("<?!="), "GASのinclude記法が残っています");
assert.ok(!previewHtml.includes("<?= "), "GASの動的テンプレート記法が残っています");
await mkdir(screenshotDirectory, { recursive: true });
const previewFile = path.join(cacheDirectory, "preview.html");
await writeFile(previewFile, previewHtml, "utf8");
const loginPreviewFile = path.join(cacheDirectory, "login-preview.html");
await writeFile(loginPreviewFile, loginPreviewHtml, "utf8");

const previewServer = createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(new URL(request.url || "/", "http://localhost").pathname === "/login" ? loginPreviewHtml : previewHtml);
});
await new Promise((resolve, reject) => {
  previewServer.once("error", reject);
  previewServer.listen(0, "127.0.0.1", resolve);
});
const previewUrl = `http://127.0.0.1:${previewServer.address().port}/`;
const loginPreviewUrl = previewUrl + "login";

const viewportSizes = [
  { name: "320px", width: 320, height: 760 },
  { name: "390px", width: 390, height: 844 },
  { name: "480px", width: 480, height: 900 },
  { name: "768px", width: 768, height: 1024 },
  { name: "1280px", width: 1280, height: 900 },
];
const previewData = `
  const date = new Date();
  const today = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  const currentUser = { email: 'admin@example.com', name: '管理者', role: 'admin', defaultMemberId: 'member-self', active: true };
  const fixture = {
    setupRequired: false, user: currentUser,
    members: [
      { id: 'member-self', name: '自分', active: true },
      { id: 'member-partner', name: 'パートナー', active: true },
      { id: 'member-family', name: '共通／家族', active: true },
    ],
    sources: [
      { id: 'source-cash', name: 'パートナー現金', active: true, walletEnabled: true, balance: 8000 },
      { id: 'source-card', name: '家族カード', active: true, walletEnabled: false, balance: 0 },
    ],
    categories: [{ id: 'cat-food', name: '食費', active: true }, { id: 'cat-home', name: '日用品', active: true }],
    places: [{ id: 'place-shop', name: 'スーパー', active: true }],
    expenses: [
      { id: 'expense-1', date: today, amount: 1200, memberId: 'member-partner', sourceId: 'source-cash', categoryId: 'cat-food', placeId: 'place-shop', memo: '夕食の買い物', createdBy: 'admin@example.com' },
      { id: 'expense-2', date: today, amount: 800, memberId: 'member-self', sourceId: 'source-card', categoryId: 'cat-home', placeId: '', memo: '日用品', createdBy: 'admin@example.com' },
    ],
    walletEntries: [{ id: 'wallet-1', date: today, type: 'topup', sourceId: 'source-cash', amount: 9200, memo: '補充' }],
    budget: { id: 'budget', month: '*', amount: 240000 },
    fixedCosts: [{ id: 'fixed-1', name: '住宅費', amount: 90000, day: 25, frequency: 'monthly', categoryId: 'cat-home', sourceId: 'source-card', placeId: 'place-shop', note: '', active: true }],
    emailRules: [{ id: 'rule-1', conditionType: 'subject', condition: '利用通知', sourceId: 'source-card', categoryId: 'cat-food', placeId: 'place-shop', active: true }],
    users: [currentUser],
  };
  window.__previewFixture = fixture;
  window.__previewCalls = [];
  window.__previewLedgerWrites = [];
  window.__previewRequestRecords = new Map();
  Object.defineProperty(window, 'google', { configurable: true, value: { script: {} } });
  Object.defineProperty(window.google.script, 'run', { configurable: true, get() {
    const runner = { success: () => {}, failure: () => {}, withSuccessHandler(callback) { this.success = callback; return this; }, withFailureHandler(callback) { this.failure = callback; return this; } };
    return new Proxy(runner, { get(target, key) {
      if (key in target) return target[key];
      return (...args) => {
        window.__previewCalls.push({ method: key, args });
        const responseData = JSON.parse(JSON.stringify(window.__previewFixture));
        const respond = () => {
          if (key === 'logoutFamilySession') {
            const failure = window.__previewFailure?.method === key ? window.__previewFailure : null;
            window.__previewFailure = null;
            if (failure) {
              window.__previewLogoutFailed = true;
              target.failure({ message: failure.message });
            } else target.success({ loggedOut: true });
            return;
          }
          if (key === 'getAppData') {
            if (args[0] === 'a'.repeat(96)) {
              target.failure({ message: 'アプリのログイン状態が無効です。もう一度Googleログインしてください。' });
              return;
            }
            if (window.__previewFailure?.method === key) {
              const failure = window.__previewFailure; window.__previewFailure = null;
              target.failure({ message: failure.message });
              return;
            }
            target.success(responseData);
            return;
          }
          if (key !== 'saveExpense' && key !== 'addWalletTopUp') {
            target.success(null);
            return;
          }
          const input = args[1] || {};
          const isExpense = key === 'saveExpense';
          const requestId = String(input.requestId || '');
          const payload = isExpense
            ? { id: String(input.id || ''), date: String(input.date || ''), memberId: String(input.memberId || ''), sourceId: String(input.sourceId || ''), categoryId: String(input.categoryId || ''), amount: Number(input.amount), memo: String(input.memo || '').trim(), placeId: String(input.placeId || ''), createdBy: 'admin@example.com' }
            : { sourceId: String(input.sourceId || ''), date: String(input.date || ''), amount: Number(input.amount), memo: String(input.memo || '補充').trim(), createdBy: 'admin@example.com' };
          const fingerprint = JSON.stringify(payload);
          const recordKey = key + ':' + requestId;
          const prior = window.__previewRequestRecords.get(recordKey);
          if (prior) {
            if (prior.fingerprint !== fingerprint) {
              target.failure({ message: '同じ保存要求IDで異なる内容は保存できません。この要求IDの内容が保存済みの可能性があるため、台帳を確認してください。' });
              return;
            }
            target.success(prior.record);
            return;
          }
          const failure = window.__previewFailure?.method === key ? window.__previewFailure : null;
          if (failure && !failure.persistBeforeFail) {
            window.__previewFailure = null;
            target.failure({ message: failure.message });
            return;
          }
          const record = isExpense
            ? { ...payload, id: 'preview-expense-' + requestId, requestId: requestId }
            : { ...payload, id: 'preview-wallet-' + requestId, type: 'topup', requestId: requestId };
          window.__previewRequestRecords.set(recordKey, { fingerprint, record });
          window.__previewLedgerWrites.push({ method: key, requestId, record });
          if (isExpense) window.__previewFixture.expenses.push(record);
          else window.__previewFixture.walletEntries.push(record);
          if (failure) {
            window.__previewFailure = null;
            target.failure({ message: failure.message });
          } else target.success(record);
        };
        if (key === 'getAppData' && window.__previewHoldData) (window.__previewPendingData ||= []).push(respond);
        else setTimeout(respond, key === 'getAppData' ? (window.__previewDataDelay || 0) : (window.__previewMutationDelay || 0));
      };
    } });
  } });
`;

let browser;

async function submitAndWait(page, selector, expectedMessage) {
  await page.evaluate((formSelector) => {
    const toast = document.querySelector('#toast');
    toast.classList.remove('is-visible');
    document.querySelector(formSelector).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }, selector);
  await page.waitForFunction((message) => {
    const toast = document.querySelector('#toast');
    return toast.classList.contains('is-visible') && toast.textContent.includes(message);
  }, expectedMessage);
}

const cachedStartupSeed = `
  const cached = JSON.parse(JSON.stringify(window.__previewFixture));
  cached.expenses[0].amount = 1100;
  cached.expenses[0].memo = '前回取得した支出';
  localStorage.setItem('money-diary-family-session-v1', 'ローカル確認用セッション');
  localStorage.setItem('money-diary-family-data-v1', JSON.stringify({ version: 1, sessionId: 'ローカル確認用セッション', generation: '確認用世代', fetchedAt: '2026-09-26T12:00:00.000Z', data: cached }));
  window.__previewDataDelay = 700;
`;

async function cachedPage(extra = '', seed = cachedStartupSeed, url = loginPreviewUrl) {
  const context = await browser.newContext({ viewport: { width: 320, height: 760 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(previewData + seed + extra);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  page.cachedErrors = errors;
  return page;
}

async function waitForLatest(page) {
  await page.evaluate(() => { window.__previewHoldData = false; for (const respond of window.__previewPendingData || []) respond(); window.__previewPendingData = []; });
  await page.waitForFunction(() => !document.querySelector('#data-sync-status').hidden && document.querySelector('#data-sync-message').textContent === '最新データを確認しました');
}

async function checkCachedStartup() {
  const page = await cachedPage('window.__previewHoldData = true;');
  assert.equal(await page.locator('#summary-total').textContent(), '1,900', '最新応答前に前回データを表示します');
  assert.match(await page.locator('#data-sync-message').textContent(), /最新データを確認中/);
  assert.match(await page.locator('#data-sync-time').textContent(), /2026/);
  await page.screenshot({ path: path.join(screenshotDirectory, 'cached-checking-320.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320, '前回値の確認表示がスマートフォン幅をはみ出しません');
  assert.equal(await page.locator('#expense-form [name="amount"]').isDisabled(), true, '確認中は支出入力を停止します');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.locator('[data-master-tab="sources"]').click();
  assert.equal(await page.locator('[data-toggle-master]').first().isDisabled(), true, '動的に作られる設定操作も停止します');
  await page.evaluate(() => {
    for (const form of document.querySelectorAll('form[data-form]')) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    for (const button of document.querySelectorAll('[data-edit-expense], [data-delete-expense], [data-toggle-master], [data-delete-setting], [data-edit-user], [data-edit-master], [data-edit-setting], [data-reset-master]')) button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  assert.deepEqual(await page.evaluate(() => window.__previewCalls.map((call) => call.method)), ['getAppData'], '無効化を迂回したイベントでも書込APIを呼びません');
  await page.getByRole('button', { name: '集計', exact: true }).click();
  await page.locator('#filter-member').selectOption('member-partner');
  assert.equal(await page.locator('#summary-total').textContent(), '1,100', '確認中もフィルターを利用できます');
  await page.locator('#filter-member').selectOption('all');
  await page.getByRole('button', { name: '次の月' }).click();
  await page.getByRole('button', { name: '前の月' }).click();
  await page.getByRole('button', { name: 'カレンダー', exact: true }).click();
  assert.ok(await page.locator('.calendar-day').count() >= 28, '確認中もカレンダーを利用できます');
  await waitForLatest(page);
  assert.equal(await page.locator('#summary-total').textContent(), '2,000', '最新応答後に画面を置き換えます');
  assert.equal(await page.locator('#expense-form [name="amount"]').isDisabled(), false, '確認成功後に編集できます');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('money-diary-family-data-v1')).data.expenses[0].amount), 1200, '最新データを保存します');
  assert.deepEqual(page.cachedErrors, []);
  await page.close();

  const failure = await cachedPage(`window.__previewFailure = { method: 'getAppData', message: '一時的に通信できません。' };`);
  await failure.waitForFunction(() => document.querySelector('#data-sync-message').textContent.includes('確認できていません'));
  assert.equal(await failure.locator('#summary-total').textContent(), '1,900', '通信失敗後も前回データを残します');
  const statusBounds = await failure.locator('#data-sync-status').evaluate((status) => { const button = status.querySelector('button').getBoundingClientRect(); return { clientWidth: status.clientWidth, scrollWidth: status.scrollWidth, right: status.getBoundingClientRect().right, buttonRight: button.right, viewportWidth: window.innerWidth }; });
  assert.ok(statusBounds.scrollWidth <= statusBounds.clientWidth, '長い失敗表示と再確認ボタンが更新領域内に収まります');
  assert.ok(statusBounds.buttonRight <= statusBounds.right && statusBounds.buttonRight <= statusBounds.viewportWidth, '再確認ボタンが320pxの画面外に出ません');
  await failure.screenshot({ path: path.join(screenshotDirectory, 'cached-failed-320.png') });
  assert.equal(await failure.evaluate(() => document.documentElement.scrollWidth), 320, '再試行表示がスマートフォン幅をはみ出しません');
  await failure.getByRole('button', { name: '集計', exact: true }).click();
  await failure.locator('#filter-source').selectOption('source-card');
  await failure.getByRole('button', { name: '設定', exact: true }).click();
  assert.equal(await failure.locator('#budgetForm [name="amount"]').isDisabled(), true, '失敗後の再描画でも編集を停止します');
  await failure.evaluate(() => { window.__previewFixture.user.role = 'member'; window.__previewFixture.users = []; });
  await failure.locator('#retry-data-button').click();
  await waitForLatest(failure);
  assert.equal(await failure.locator('#userForm').count(), 0, '再確認で管理者から降格した設定を除去します');
  assert.equal(await failure.evaluate(() => JSON.parse(localStorage.getItem('money-diary-family-data-v1')).data.users.length), 0, '降格後は管理者向けデータを保存値から除去します');
  assert.deepEqual(failure.cachedErrors, []);
  await failure.close();

  const member = await cachedPage(`const saved = JSON.parse(localStorage.getItem('money-diary-family-data-v1')); saved.data.user.role = 'member'; saved.data.users = []; localStorage.setItem('money-diary-family-data-v1', JSON.stringify(saved)); window.__previewFixture.user.role = 'member'; window.__previewFixture.users = [];`);
  assert.equal(await member.locator('#summary-total').textContent(), '1,900', '一般利用者の前回データも復元します');
  await waitForLatest(member); await member.close();

  for (const corrupt of [
    `localStorage.setItem('money-diary-family-data-v1', '{');`,
    `saved.data.expenses = null;`, `saved.data.expenses = [null];`, `saved.data.budget = '破損';`,
    `saved.generation = '旧世代';`, `saved.sessionId = '別のセッション';`, `saved.data.setupRequired = true;`, `saved.fetchedAt = '破損';`,
  ]) {
    const extra = corrupt.startsWith('localStorage') ? corrupt : `const saved = JSON.parse(localStorage.getItem('money-diary-family-data-v1')); ${corrupt} localStorage.setItem('money-diary-family-data-v1', JSON.stringify(saved));`;
    const invalid = await cachedPage(extra);
    assert.equal(await invalid.locator('#app-shell').isVisible(), false, '破損・世代違い・別セッション・初期設定データを復元しません');
    assert.equal(await invalid.evaluate(() => localStorage.getItem('money-diary-family-data-v1')), null, '不正な保存値はすぐ破棄します');
    await waitForLatest(invalid); assert.deepEqual(invalid.cachedErrors, []); await invalid.close();
  }

  const newLogin = await cachedPage('', cachedStartupSeed, previewUrl);
  assert.equal(await newLogin.locator('#app-shell').isVisible(), false, '新規Googleログインでは以前の保存値を表示しません');
  await waitForLatest(newLogin); await newLogin.close();

  for (const unavailable of [
    `const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === 'money-diary-family-data-v1') throw new DOMException('容量不足', 'QuotaExceededError'); return original.call(this, key, value); };`,
    `Storage.prototype.getItem = function() { throw new DOMException('保存領域を利用できません', 'SecurityError'); }; Storage.prototype.setItem = function() { throw new DOMException('保存領域を利用できません', 'SecurityError'); };`,
  ]) {
    const blocked = await cachedPage(unavailable, `window.__previewDataDelay = 80;`, previewUrl);
    await waitForLatest(blocked);
    assert.equal(await blocked.locator('#expense-form [name="amount"]').isDisabled(), false, '保存不可でも最新取得後は利用できます');
    assert.deepEqual(blocked.cachedErrors, []); await blocked.close();
  }

  for (const rejected of ['アプリのログイン状態が無効です。もう一度Googleログインしてください。', 'このGoogleアカウントは利用を許可されていません。']) {
    const denied = await cachedPage(`window.__previewFailure = { method: 'getAppData', message: ${JSON.stringify(rejected)} };`);
    await denied.waitForFunction(() => !document.querySelector('#login-screen').hidden);
    assert.equal(await denied.evaluate(() => localStorage.getItem('money-diary-family-data-v1')), null, '失効・利用停止時に家計データを削除します');
    assert.equal(await denied.evaluate(() => localStorage.getItem('money-diary-family-session-v1')), null);
    assert.equal(await denied.locator('#settings-content').textContent(), '', '失効後は画面内の管理者データも削除します');
    await denied.close();
  }

  for (const retry of [false, true]) {
    const logout = await cachedPage(retry ? `window.__previewFailure = { method: 'getAppData', message: '一時通信失敗' };` : '');
    if (retry) {
      await logout.waitForFunction(() => document.querySelector('#data-sync-message').textContent.includes('確認できていません'));
      await logout.locator('#retry-data-button').click();
    }
    await logout.locator('#logout-button').click();
    await logout.waitForTimeout(800);
    assert.equal(await logout.locator('#app-shell').isVisible(), false, '起動・再試行の遅延成功でもログアウト後の画面を復元しません');
    assert.equal(await logout.evaluate(() => localStorage.getItem('money-diary-family-data-v1')), null);
    assert.deepEqual(logout.cachedErrors, []); await logout.close();
  }

  for (const storageChange of ['logout', 'switch']) {
    const tab = await cachedPage();
    const other = await tab.context().newPage();
    await other.goto(loginPreviewUrl, { waitUntil: 'domcontentloaded' });
    await other.evaluate((kind) => {
      if (kind === 'logout') { localStorage.removeItem('money-diary-family-session-v1'); localStorage.removeItem('money-diary-family-data-v1'); }
      else localStorage.setItem('money-diary-family-session-v1', '別のセッション');
    }, storageChange);
    await tab.waitForFunction(() => !document.querySelector('#login-screen').hidden);
    await tab.waitForTimeout(800);
    assert.equal(await tab.locator('#app-shell').isVisible(), false, '別タブのログアウト・セッション変更で古い画面と遅延応答を解除します');
    assert.deepEqual(tab.cachedErrors, []); await other.close(); await tab.close();
  }

  const overlapping = await cachedPage(`window.__previewDataDelay = 0; window.__previewFailure = { method: 'getAppData', message: '一時通信失敗' };`);
  await overlapping.waitForFunction(() => document.querySelector('#data-sync-message').textContent.includes('確認できていません'));
  await overlapping.evaluate(() => {
    window.__previewHoldData = true;
    document.querySelector('#retry-data-button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    window.__previewFixture.expenses[0].amount = 2200;
    document.querySelector('#retry-data-button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    window.__previewPendingData[1]();
  });
  await overlapping.waitForFunction(() => document.querySelector('#summary-total').textContent === '3,000');
  await overlapping.evaluate(() => window.__previewPendingData[0]());
  await overlapping.waitForTimeout(30);
  assert.equal(await overlapping.locator('#summary-total').textContent(), '3,000', '重複した再確認の古い応答で最新画面を上書きしません');
  assert.equal(await overlapping.evaluate(() => JSON.parse(localStorage.getItem('money-diary-family-data-v1')).data.expenses[0].amount), 2200, '重複した再確認でも最新応答だけを保存します');
  assert.deepEqual(overlapping.cachedErrors, []); await overlapping.close();

  const pendingWrite = await cachedPage('window.__previewDataDelay = 0; window.__previewMutationDelay = 700;');
  await waitForLatest(pendingWrite);
  await pendingWrite.getByRole('button', { name: '設定', exact: true }).click();
  await pendingWrite.evaluate(() => document.querySelector('#budgetForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await pendingWrite.locator('#logout-button').click();
  await pendingWrite.waitForTimeout(800);
  assert.equal(await pendingWrite.locator('#app-shell').isVisible(), false, '保存の遅延応答後もログアウトを維持します');
  assert.equal(await pendingWrite.evaluate(() => localStorage.getItem('money-diary-family-data-v1')), null, '保存の遅延応答で家計データを再保存しません');
  assert.equal(await pendingWrite.evaluate(() => window.__previewCalls.filter((call) => call.method === 'getAppData').length), 1, 'ログアウト後の保存応答から再取得を開始しません');
  assert.deepEqual(pendingWrite.cachedErrors, []); await pendingWrite.close();

  const deniedRefresh = await cachedPage('window.__previewDataDelay = 0;');
  await waitForLatest(deniedRefresh);
  await deniedRefresh.getByRole('button', { name: '設定', exact: true }).click();
  await deniedRefresh.evaluate(() => { window.__previewFailure = { method: 'getAppData', message: 'このGoogleアカウントは利用を許可されていません。' }; document.querySelector('#budgetForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await deniedRefresh.waitForFunction(() => !document.querySelector('#login-screen').hidden);
  assert.equal(await deniedRefresh.evaluate(() => localStorage.getItem('money-diary-family-data-v1')), null, '通常の保存後の再取得でも利用停止時に保存値を削除します');
  assert.deepEqual(deniedRefresh.cachedErrors, []); await deniedRefresh.close();

  const setup = await cachedPage(`window.__previewFixture = { setupRequired: true, user: window.__previewFixture.user, missingTables: ['Expenses'] };`);
  await setup.locator('[data-initialize-ledger]').waitFor({ state: 'visible' });
  assert.equal(await setup.evaluate(() => localStorage.getItem('money-diary-family-data-v1')), null, '初期化待ち応答では家計データを削除します');
  assert.equal(await setup.locator('#data-sync-status').isVisible(), false);
  assert.equal(await setup.locator('#recent-transactions').textContent(), '', '初期化待ちでは前回の支出を画面から除去します');
  assert.equal(await setup.getByRole('button', { name: '集計', exact: true }).isDisabled(), true);
  assert.equal(await setup.locator('[data-initialize-ledger]').isDisabled(), false, '権限確認済み管理者は初期化できます');
  await setup.evaluate(() => { const cached = JSON.parse(JSON.stringify(window.__previewFixture)); window.__previewFixture = { setupRequired: false, user: cached.user, members: [], sources: [], categories: [], places: [], expenses: [], walletEntries: [], budget: null, fixedCosts: [], emailRules: [], users: [cached.user] }; });
  await setup.evaluate(() => { window.__previewFailure = { method: 'getAppData', message: '初期化後の再取得に一時失敗しました。' }; });
  await setup.locator('[data-initialize-ledger]').click();
  await setup.waitForFunction(() => !document.querySelector('#data-sync-status').hidden && document.querySelector('#data-sync-message').textContent.includes('確認中'));
  assert.equal(await setup.locator('[data-initialize-ledger]').isDisabled(), true, '初期化後の再取得中は初期化の再実行を停止します');
  assert.equal(await setup.locator('#retry-data-button').isVisible(), false, '初期化後の再取得中は再確認ボタンを隠します');
  await setup.locator('#retry-data-button').waitFor({ state: 'visible' });
  assert.match(await setup.locator('#data-sync-message').textContent(), /最新データを確認できていません/, '初期設定中の再取得失敗も常設表示します');
  assert.equal(await setup.locator('[data-initialize-ledger]').isDisabled(), true, '初期化後の再取得失敗では初期化の重複実行を停止します');
  assert.equal(await setup.evaluate(() => localStorage.getItem('money-diary-family-data-v1')), null, '初期化後の再取得失敗では家計データを保存しません');
  await setup.locator('#retry-data-button').click();
  await waitForLatest(setup);
  assert.equal(await setup.locator('#expense-form [name="amount"]').isDisabled(), false, '初期化後の再確認成功で編集を有効にします');
  assert.equal(await setup.evaluate(() => window.__previewCalls.some((call) => call.method === 'initializeFamilyLedger')), true, '確認済み管理者の初期化APIを実行します');
  assert.equal(await setup.getByRole('button', { name: '集計', exact: true }).isDisabled(), false, '初期化後は通常の閲覧へ戻ります');
  assert.notEqual(await setup.evaluate(() => localStorage.getItem('money-diary-family-data-v1')), null, '初期化後の最新データを保存します');
  assert.deepEqual(setup.cachedErrors, []); await setup.close();

  const cold = await cachedPage(`window.__previewFailure = { method: 'getAppData', message: '一時通信失敗' };`, `localStorage.setItem('money-diary-family-session-v1', 'ローカル確認用セッション'); window.__previewDataDelay = 80;`);
  await cold.locator('#retry-login-button').waitFor({ state: 'visible' });
  await cold.locator('#retry-login-button').click(); await waitForLatest(cold); await cold.close();
  console.log('前回データ確認: 即表示・閲覧専用・再描画・再試行・権限変更・保存破損/不可・世代/セッション分離・失効・ログアウト/別タブ/遅延応答・初期設定を確認しました。');
}

try {
  const { chromium } = await import("playwright");
  browser = await chromium.launch({ headless: true });
  await checkCachedStartup();
  const loginPage = await browser.newPage();
    await loginPage.goto(loginPreviewUrl, { waitUntil: "networkidle" });
  const loginLink = loginPage.locator("#google-login-link");
  await loginLink.waitFor({ state: "visible" });
  const authorizationUrl = new URL(await loginLink.getAttribute("href"));
  assert.equal(await loginLink.getAttribute("target"), "_top", "Google認証へトップレベルで遷移します");
  assert.equal(authorizationUrl.origin + authorizationUrl.pathname, "https://accounts.google.com/o/oauth2/v2/auth", "ログインリンクはGoogleの認可画面へ移動します");
  assert.equal(authorizationUrl.searchParams.get("response_type"), "code", "ログインリンクでは認証コードフローを開始します");
  assert.equal(authorizationUrl.searchParams.get("scope"), "openid email", "ログインリンクはopenidとemailだけを要求します");
  assert.equal(authorizationUrl.searchParams.get("redirect_uri"), "https://script.google.com/macros/d/1zhqVIRy5YKrDURd77Tl5I4Za4f-1kvGqyJbvwnesW1HLFt8j7InXa3sQ/usercallback", "ログインリンクは指定のusercallbackへ戻ります");
  assert.equal(authorizationUrl.searchParams.get("state"), "local-state-token");
  assert.equal(authorizationUrl.searchParams.get("nonce"), "local-one-time-nonce");
  assert.equal(await loginPage.locator("script[src*='gsi/client']").count(), 0, "GISクライアントを読み込みません");
  await loginPage.close();
  for (const viewport of viewportSizes) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(previewData);
    await page.goto(previewUrl, { waitUntil: "networkidle" });
    await page.locator("#app-shell").waitFor({ state: "visible" });
    assert.equal(await page.locator("#auth-bootstrap").count(), 0, `${viewport.name}: callbackのセッションを読み取った後にHTMLから除去します`);
    assert.equal(await page.evaluate(() => window.__previewCalls.find((call) => call.method === 'getAppData')?.args[0]), "ローカル確認用セッション", `${viewport.name}: アプリセッションでサーバーAPIを開始します`);
    assert.equal(await page.evaluate(() => localStorage.getItem('money-diary-family-session-v1')), "ローカル確認用セッション", `${viewport.name}: アプリセッションをブラウザーへ保存します`);

    const measurements = await page.evaluate(() => {
      const shell = document.querySelector(".app-shell");
      const navigation = document.querySelector(".bottom-nav");
      return {
        documentWidth: document.documentElement.scrollWidth,
        shellClientWidth: shell.clientWidth,
        shellScrollWidth: shell.scrollWidth,
        shellLeft: shell.getBoundingClientRect().left,
        shellWidth: shell.getBoundingClientRect().width,
        navigationLeft: navigation.getBoundingClientRect().left,
        navigationWidth: navigation.getBoundingClientRect().width,
        navigationBottom: navigation.getBoundingClientRect().bottom,
        navigationItems: navigation.querySelectorAll("[data-view]").length,
        navigationPosition: getComputedStyle(navigation).position,
      };
    });
    assert.ok(measurements.documentWidth <= viewport.width, `${viewport.name}: 横にはみ出しています`);
    assert.ok(measurements.shellScrollWidth <= measurements.shellClientWidth, `${viewport.name}: アプリ内で横にはみ出しています`);
    assert.ok(Math.abs(measurements.shellWidth - Math.min(viewport.width, 480)) <= 1, `${viewport.name}: アプリ幅が480px基準ではありません`);
    assert.ok(Math.abs(measurements.shellLeft - (viewport.width - measurements.shellWidth) / 2) <= 1, `${viewport.name}: アプリが中央配置されていません`);
    assert.equal(measurements.navigationPosition, "fixed", `${viewport.name}: 下部ナビが固定されていません`);
    assert.equal(measurements.navigationItems, 4, `${viewport.name}: 下部ナビが4項目ではありません`);
    assert.ok(Math.abs(measurements.navigationWidth - Math.min(viewport.width, 480)) <= 1, `${viewport.name}: ナビ幅がアプリと一致しません`);
    assert.ok(Math.abs(measurements.navigationLeft - (viewport.width - measurements.navigationWidth) / 2) <= 1, `${viewport.name}: 下部ナビが中央配置されていません`);
    assert.ok(Math.abs(measurements.navigationBottom - viewport.height) <= 1, `${viewport.name}: 下部ナビが画面下端にありません`);
    assert.equal(await page.locator("#summary-total").textContent(), "2,000", `${viewport.name}: 家族支出が集計されていません`);
    assert.equal(await page.locator("#category-donut").count(), 1, `${viewport.name}: カテゴリ別円グラフがありません`);
    assert.equal(await page.locator("#category-trend-months .category-trend-column").count(), 12, `${viewport.name}: 12か月のカテゴリ推移がありません`);
    assert.equal(await page.locator("#wallet-balances .wallet-balance-row").count(), 1, `${viewport.name}: 財布残高が表示されていません`);
    await page.locator("#filter-member").selectOption("member-partner");
    assert.equal(await page.locator("#summary-total").textContent(), "1,200", `${viewport.name}: 利用者フィルターが独立していません`);
    await page.locator("#filter-member").selectOption("all");
    await page.locator("#filter-source").selectOption("source-card");
    assert.equal(await page.locator("#summary-total").textContent(), "800", `${viewport.name}: 支払元フィルターが独立していません`);
    await page.locator("#filter-source").selectOption("all");

    for (const [view, label] of [["summary", "集計"], ["input", "入力"], ["calendar", "カレンダー"], ["settings", "設定"]]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await page.locator(`#view-${view}`).waitFor({ state: "visible" });
      const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, shell: document.querySelector('.app-shell').scrollWidth, client: document.querySelector('.app-shell').clientWidth }));
      assert.ok(widths.document <= viewport.width && widths.shell <= widths.client, `${viewport.name}・${label}: 横にはみ出しています`);
      if (view === "input") {
        assert.equal(await page.locator('#expense-form [name="memberId"] option').count(), 4, `${viewport.name}: 利用者が選べません`);
        assert.equal(await page.locator('#expense-form [name="sourceId"] option').count(), 3, `${viewport.name}: 支払元が選べません`);
        assert.match(await page.locator('#expense-form [name="requestId"]').inputValue(), /^[A-Za-z0-9_-]{8,100}$/, `${viewport.name}: 支出の再送防止IDがありません`);
        if (viewport.width === 320) {
          const today = await page.evaluate(() => { const date = new Date(); return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'); });
          await page.locator('#expense-form [name="date"]').fill(today);
          await page.locator('#expense-form [name="amount"]').fill('100');
          await page.locator('#expense-form [name="memberId"]').selectOption('member-self');
          await page.locator('#expense-form [name="sourceId"]').selectOption('source-cash');
          await page.locator('#expense-form [name="categoryId"]').selectOption('cat-food');
          await page.locator('#expense-form [name="memo"]').fill('二重送信の確認');
          const initialExpenseRequestId = await page.locator('#expense-form [name="requestId"]').inputValue();
          await page.evaluate(() => {
            const form = document.querySelector('#expense-form');
            const event = new Event('submit', { bubbles: true, cancelable: true });
            form.dispatchEvent(event);
            form.dispatchEvent(event);
          });
          await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('支出を保存しました'));
          assert.equal(await page.evaluate(() => window.__previewCalls.filter((call) => call.method === 'saveExpense').length), 1, "二重送信の間は支出保存APIを一度だけ呼びます");
          assert.equal(await page.evaluate((requestId) => window.__previewLedgerWrites.filter((row) => row.method === 'saveExpense' && row.requestId === requestId).length, initialExpenseRequestId), 1, "二重送信では支出台帳に一件だけ保存します");
          assert.equal(await page.evaluate((requestId) => JSON.parse(localStorage.getItem('money-diary-family-data-v1')).data.expenses.some((record) => record.requestId === requestId), initialExpenseRequestId), true, "通常の支出保存後にも最新データをブラウザー保存します");
          const postSuccessExpenseId = await page.locator('#expense-form [name="requestId"]').inputValue();
          assert.notEqual(postSuccessExpenseId, initialExpenseRequestId, "支出成功後は新しい入力用の要求IDを発行します");
          await page.locator('#expense-form [name="amount"]').fill('444');
          await page.locator('#expense-form [name="memo"]').fill('未保存の金額を修正');
          const repairExpenseRequestId = await page.locator('#expense-form [name="requestId"]').inputValue();
          await page.evaluate(() => {
            window.__previewFailure = { method: 'saveExpense', persistBeforeFail: false, message: '金額は1円以上の整数で入力してください。' };
          });
          await submitAndWait(page, '#expense-form', '金額は1円以上');
          assert.equal(await page.locator('#expense-form [name="requestId"]').inputValue(), repairExpenseRequestId, "未保存の支出バリデーション失敗後も要求IDを保持します");
          assert.equal(await page.locator('#expense-form [name="amount"]').inputValue(), '444', "支出バリデーションエラー後も金額を保持します");
          await page.locator('#expense-form [name="amount"]').fill('445');
          assert.equal(await page.locator('#expense-form [name="requestId"]').inputValue(), repairExpenseRequestId, "支出修正時も同じ要求IDを保持します");
          await submitAndWait(page, '#expense-form', '支出を保存しました');
          assert.equal(await page.evaluate((requestId) => window.__previewLedgerWrites.filter((row) => row.method === 'saveExpense' && row.requestId === requestId).length, repairExpenseRequestId), 1, "未保存エラー修正後は支出を一件保存します");
          assert.equal((await page.evaluate((requestId) => window.__previewLedgerWrites.find((row) => row.requestId === requestId).record.amount, repairExpenseRequestId)), 445, "修正した支出金額を保存します");

          await page.locator('#expense-form [name="date"]').fill(today);
          await page.locator('#expense-form [name="amount"]').fill('600');
          await page.locator('#expense-form [name="memberId"]').selectOption('member-self');
          await page.locator('#expense-form [name="sourceId"]').selectOption('source-cash');
          await page.locator('#expense-form [name="categoryId"]').selectOption('cat-food');
          await page.locator('#expense-form [name="memo"]').fill('応答エラー後の元データ');
          const ambiguousExpenseRequestId = await page.locator('#expense-form [name="requestId"]').inputValue();
          await page.evaluate(() => {
            window.__previewFailure = { method: 'saveExpense', persistBeforeFail: true, message: 'サーバー応答を受信できませんでした。' };
          });
          await submitAndWait(page, '#expense-form', 'サーバー応答を受信できませんでした');
          assert.equal(await page.locator('#expense-form [name="requestId"]').inputValue(), ambiguousExpenseRequestId, "保存後の応答エラーでは支出要求IDを保持します");
          assert.equal(await page.locator('#expense-form [name="amount"]').inputValue(), '600', "保存後の応答エラーでは入力値を保持します");
          await page.locator('#expense-form [name="amount"]').fill('601');
          await page.locator('#expense-form [name="memo"]').fill('応答エラー後の修正値');
          assert.equal(await page.locator('#expense-form [name="requestId"]').inputValue(), ambiguousExpenseRequestId, "応答エラー後に編集しても支出要求IDを変えません");
          await submitAndWait(page, '#expense-form', '台帳を確認してください');
          const ambiguousExpenseWrites = await page.evaluate((requestId) => window.__previewLedgerWrites.filter((row) => row.method === 'saveExpense' && row.requestId === requestId), ambiguousExpenseRequestId);
          assert.equal(ambiguousExpenseWrites.length, 1, "応答エラー後の異なる支出再送は一件だけを維持します");
          assert.equal(ambiguousExpenseWrites[0].record.amount, 600, "応答エラー後の再送拒否で元の支出額を維持します");
          assert.equal(await page.evaluate((requestId) => window.__previewCalls.filter((call) => call.method === 'saveExpense' && call.args[1].requestId === requestId).length, ambiguousExpenseRequestId), 2, "支出の応答エラー後に同じ要求IDで再送します");
        }
      }
      if (view === "settings") {
        assert.equal(await page.locator("#user-list .settings-record").count(), 1, `${viewport.name}: ユーザー設定が表示されていません`);
        assert.equal(await page.locator("#master-list .settings-record").count(), 3, `${viewport.name}: 利用者マスタが表示されていません`);
        assert.match(await page.locator('#topupForm [name="requestId"]').inputValue(), /^[A-Za-z0-9_-]{8,100}$/, `${viewport.name}: 財布補充の再送防止IDがありません`);
        if (viewport.width === 320) {
          const today = await page.evaluate(() => { const date = new Date(); return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'); });
          await page.locator('#topupForm [name="topupSourceId"]').selectOption('source-cash');
          await page.locator('#topupForm [name="date"]').fill(today);
          await page.locator('#topupForm [name="amount"]').fill('200');
          await page.locator('#topupForm [name="memo"]').fill('二重送信の確認');
          const initialTopUpRequestId = await page.locator('#topupForm [name="requestId"]').inputValue();
          await page.evaluate(() => {
            const form = document.querySelector('#topupForm');
            const event = new Event('submit', { bubbles: true, cancelable: true });
            form.dispatchEvent(event);
            form.dispatchEvent(event);
          });
          await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('財布の補充を記録しました'));
          assert.equal(await page.evaluate(() => window.__previewCalls.filter((call) => call.method === 'addWalletTopUp').length), 1, "二重送信の間は財布補充APIを一度だけ呼びます");
          assert.equal(await page.evaluate((requestId) => window.__previewLedgerWrites.filter((row) => row.method === 'addWalletTopUp' && row.requestId === requestId).length, initialTopUpRequestId), 1, "二重送信では財布履歴に一件だけ保存します");
          const postSuccessTopUpId = await page.locator('#topupForm [name="requestId"]').inputValue();
          assert.notEqual(postSuccessTopUpId, initialTopUpRequestId, "補充成功後は新しい入力用の要求IDを発行します");
          assert.equal(await page.locator('#topupForm [name="amount"]').inputValue(), '', "補充成功後に金額入力を初期化します");
          assert.equal(await page.locator('#topupForm [name="date"]').inputValue(), today, "補充成功後に日付を今日へ戻します");
          assert.equal(await page.locator('#topupForm [name="topupSourceId"]').inputValue(), 'source-cash', "補充成功後に既定の財布を選択します");
          await page.locator('#topupForm [name="amount"]').fill('300');
          await page.locator('#topupForm [name="memo"]').fill('未保存の補充を修正');
          const repairTopUpRequestId = await page.locator('#topupForm [name="requestId"]').inputValue();
          await page.evaluate(() => {
            window.__previewFailure = { method: 'addWalletTopUp', persistBeforeFail: false, message: '補充額は1円以上の整数で入力してください。' };
          });
          await submitAndWait(page, '#topupForm', '補充額は1円以上');
          assert.equal(await page.locator('#topupForm [name="requestId"]').inputValue(), repairTopUpRequestId, "未保存の補充バリデーション失敗後も要求IDを保持します");
          assert.equal(await page.locator('#topupForm [name="amount"]').inputValue(), '300', "補充バリデーションエラー後も金額を保持します");
          await page.locator('#topupForm [name="amount"]').fill('301');
          assert.equal(await page.locator('#topupForm [name="requestId"]').inputValue(), repairTopUpRequestId, "補充修正時も同じ要求IDを保持します");
          await submitAndWait(page, '#topupForm', '財布の補充を記録しました');
          assert.equal(await page.evaluate((requestId) => window.__previewLedgerWrites.filter((row) => row.method === 'addWalletTopUp' && row.requestId === requestId).length, repairTopUpRequestId), 1, "未保存エラー修正後は補充を一件保存します");
          assert.equal(await page.evaluate((requestId) => window.__previewLedgerWrites.find((row) => row.requestId === requestId).record.amount, repairTopUpRequestId), 301, "修正した補充額を保存します");

          await page.locator('#topupForm [name="topupSourceId"]').selectOption('source-cash');
          await page.locator('#topupForm [name="date"]').fill(today);
          await page.locator('#topupForm [name="amount"]').fill('600');
          await page.locator('#topupForm [name="memo"]').fill('応答エラー後の元データ');
          const ambiguousTopUpRequestId = await page.locator('#topupForm [name="requestId"]').inputValue();
          await page.evaluate(() => {
            window.__previewFailure = { method: 'addWalletTopUp', persistBeforeFail: true, message: 'サーバー応答を受信できませんでした。' };
          });
          await submitAndWait(page, '#topupForm', 'サーバー応答を受信できませんでした');
          assert.equal(await page.locator('#topupForm [name="requestId"]').inputValue(), ambiguousTopUpRequestId, "保存後の応答エラーでは補充要求IDを保持します");
          assert.equal(await page.locator('#topupForm [name="amount"]').inputValue(), '600', "保存後の応答エラーでは補充入力を保持します");
          assert.equal(await page.locator('#topupForm [name="memo"]').inputValue(), '応答エラー後の元データ', "保存後の応答エラーでは補充メモを保持します");
          await page.getByRole('button', { name: '集計', exact: true }).click();
          await page.locator('#filter-source').selectOption('source-card');
          await page.getByRole('button', { name: '設定', exact: true }).click();
          assert.equal(await page.locator('#topupForm [name="requestId"]').inputValue(), ambiguousTopUpRequestId, "renderAll再描画後も補充要求IDを復元します");
          assert.equal(await page.locator('#topupForm').evaluate((form) => form.dataset.requestAttempted), 'true', "renderAll再描画後も補充送信済み状態を復元します");
          assert.equal(await page.locator('#topupForm [name="amount"]').inputValue(), '600', "renderAll再描画後も補充額を復元します");
          assert.equal(await page.locator('#topupForm [name="memo"]').inputValue(), '応答エラー後の元データ', "renderAll再描画後も補充メモを復元します");
          await page.locator('#topupForm [name="amount"]').fill('601');
          await page.locator('#topupForm [name="memo"]').fill('応答エラー後の修正値');
          assert.equal(await page.locator('#topupForm [name="requestId"]').inputValue(), ambiguousTopUpRequestId, "応答エラー後に編集しても補充要求IDを変えません");
          await submitAndWait(page, '#topupForm', '台帳を確認してください');
          const ambiguousTopUpWrites = await page.evaluate((requestId) => window.__previewLedgerWrites.filter((row) => row.method === 'addWalletTopUp' && row.requestId === requestId), ambiguousTopUpRequestId);
          assert.equal(ambiguousTopUpWrites.length, 1, "応答エラー後の異なる補充再送は一件だけを維持します");
          assert.equal(ambiguousTopUpWrites[0].record.amount, 600, "応答エラー後の再送拒否で元の補充額を維持します");
          assert.equal(await page.evaluate((requestId) => window.__previewCalls.filter((call) => call.method === 'addWalletTopUp' && call.args[1].requestId === requestId).length, ambiguousTopUpRequestId), 2, "補充の応答エラー後に同じ要求IDで再送します");

          await page.goto(loginPreviewUrl, { waitUntil: 'networkidle' });
          await page.locator('#app-shell').waitFor({ state: 'visible' });
          assert.equal(await page.evaluate(() => window.__previewCalls.filter((call) => call.method === 'getAppData').at(-1)?.args[0]), 'ローカル確認用セッション', "再読み込み後は保存済みセッションをサーバーで再確認します");
          await page.reload({ waitUntil: 'networkidle' });
          await page.locator('#app-shell').waitFor({ state: 'visible' });
          assert.equal(await page.evaluate(() => window.__previewCalls.filter((call) => call.method === 'getAppData').at(-1)?.args[0]), 'ローカル確認用セッション', "有効なlocalStorageセッションはページ再読み込み後も復元されます");
          assert.equal(await page.evaluate(() => localStorage.getItem('money-diary-family-session-v1')), 'ローカル確認用セッション', "再読み込み後も有効なセッション値を保持します");
          await page.getByRole('button', { name: '設定', exact: true }).click();
          await page.locator('#topupForm [name="topupSourceId"]').selectOption('source-cash');
          await page.locator('#topupForm [name="date"]').fill(today);
          await page.locator('#topupForm [name="amount"]').fill('777');
          await page.locator('#topupForm [name="memo"]').fill('画面更新失敗後の再入力');
          const savedBeforeRefreshFailureId = await page.locator('#topupForm [name="requestId"]').inputValue();
          await page.evaluate(() => {
            window.__previewFailure = { method: 'getAppData', message: '画面読込の試験失敗' };
          });
          await submitAndWait(page, '#topupForm', '画面を更新できませんでした');
          const savedAfterRefreshFailureId = await page.locator('#topupForm [name="requestId"]').inputValue();
          assert.notEqual(savedAfterRefreshFailureId, savedBeforeRefreshFailureId, "補充API成功時点で次の入力用要求IDへ切り替えます");
          assert.equal(await page.locator('#topupForm [name="amount"]').inputValue(), '', "refresh失敗後に保存済み補充額をフォームへ戻しません");
          assert.equal(await page.locator('#topupForm [name="memo"]').inputValue(), '補充', "refresh失敗後に保存済みメモをフォームへ戻しません");
          assert.equal(await page.evaluate((requestId) => window.__previewLedgerWrites.filter((row) => row.method === 'addWalletTopUp' && row.requestId === requestId).length, savedBeforeRefreshFailureId), 1, "画面更新失敗前に補充履歴を一件保存します");
          assert.equal(await page.evaluate((requestId) => window.__previewLedgerWrites.find((row) => row.requestId === requestId).record.amount, savedBeforeRefreshFailureId), 777, "画面更新失敗後も保存済みの補充額を確認できます");
          await page.getByRole('button', { name: '集計', exact: true }).click();
          await page.locator('#filter-source').selectOption('source-card');
          await page.getByRole('button', { name: '次の月' }).click();
          await page.getByRole('button', { name: '設定', exact: true }).click();
          assert.equal(await page.locator('#topupForm [name="requestId"]').inputValue(), savedAfterRefreshFailureId, "refresh失敗後のrenderAllでも新しい要求IDを保持します");
          assert.equal(await page.locator('#topupForm [name="amount"]').inputValue(), '', "refresh失敗後の再描画でも古い補充額を復元しません");
          assert.equal(await page.locator('#topupForm [name="amount"]').isDisabled(), true, "更新失敗後は再描画後も補充入力を停止します");
          await submitAndWait(page, '#topupForm', '閲覧のみ利用できます');
          assert.equal(await page.evaluate(() => window.__previewCalls.filter((call) => call.method === 'addWalletTopUp').length), 1, "更新失敗後は保存済み補充を再送しません");
          await page.locator('#retry-data-button').click();
          await page.waitForFunction(() => !document.querySelector('#data-sync-status').hidden && document.querySelector('#data-sync-message').textContent === '最新データを確認しました');
          assert.equal(await page.locator('#topupForm [name="amount"]').isDisabled(), false, "再確認成功後は新しい補充を入力できます");
        }
      }
      await page.screenshot({ path: path.join(screenshotDirectory, `${view}-${viewport.width}.png`) });
    }
    if (viewport.width === 320) {
      await page.evaluate(async () => {
        const now = new Date();
        const year = now.getFullYear(); const month = String(now.getMonth() + 1).padStart(2, '0');
        const days = new Date(year, now.getMonth() + 1, 0).getDate();
        window.__previewFixture.expenses = Array.from({ length: days }, (_, index) => ({
          id: `heat-${index + 1}`, date: `${year}-${month}-${String(index + 1).padStart(2, '0')}`,
          amount: index + 1 === days ? 1000000 : (index + 1) * 1000,
          memberId: 'member-self', sourceId: 'source-card', categoryId: index % 2 ? 'cat-food' : 'cat-home', placeId: '', memo: 'カレンダー確認',
        }));
      });
      await submitAndWait(page, '#budgetForm', '月予算を保存しました');
      await page.getByRole('button', { name: '集計', exact: true }).click();
      await page.getByRole('button', { name: '前の月' }).click();
      await page.getByRole("button", { name: "カレンダー", exact: true }).click();
      const heat = await page.evaluate((lastDay) => [1, 2, lastDay].map((day) => Number(document.querySelector(`.calendar-day[data-day="${day}"]`).style.getPropertyValue('--heat-intensity'))), new Date().getDate() ? new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() : 30);
      assert.ok(heat[0] > 0 && heat[0] < heat[1] && heat[1] < heat[2], "95パーセンタイルで大口支出を抑え、通常日の濃淡を保ちます");
    }
    if (viewport.width === 320) {
      await page.evaluate(() => { window.__previewFailure = { method: 'logoutFamilySession', message: '失効に失敗しました。' }; });
    }
    await page.locator('#logout-button').click();
    await page.locator('#login-screen').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => localStorage.getItem('money-diary-family-session-v1')), null, `${viewport.name}: ログアウト時にブラウザーのセッションを削除します`);
    assert.equal(await page.evaluate(() => window.__previewCalls.find((call) => call.method === 'logoutFamilySession')?.args[0]), 'ローカル確認用セッション', `${viewport.name}: ログアウト時にサーバーへセッション失効を依頼します`);
    if (viewport.width === 320) {
      await page.waitForFunction(() => window.__previewLogoutFailed === true);
      assert.equal(await page.evaluate(() => localStorage.getItem('money-diary-family-session-v1')), null, 'サーバー失効に失敗してもブラウザーのセッションを削除します');
      assert.equal(await page.locator('#login-status').textContent(), 'サーバーでのログアウト処理に失敗しました。ブラウザーのログイン状態は削除しました。', 'サーバー失効失敗時は成功とせず、日本語で状況を知らせます');
    }
    assert.deepEqual(errors, [], `${viewport.name}: JavaScriptエラーがあります`);
    await page.close();
    console.log(`${viewport.name}: ログイン後の集計・入力・カレンダー・設定を確認しました。`);
  }
  const staleSessionPage = await browser.newPage();
  await staleSessionPage.addInitScript(() => localStorage.setItem('money-diary-family-session-v1', 'a'.repeat(96)));
  await staleSessionPage.addInitScript(previewData);
  await staleSessionPage.goto(loginPreviewUrl, { waitUntil: 'networkidle' });
  await staleSessionPage.locator('#login-screen').waitFor({ state: 'visible' });
  await staleSessionPage.waitForFunction(() => document.querySelector('#login-status').textContent.includes('ログイン状態が無効'));
  assert.equal(await staleSessionPage.evaluate(() => localStorage.getItem('money-diary-family-session-v1')), null, '世代違いのセッションは画面へ戻る前にブラウザーから削除します');
  assert.equal(await staleSessionPage.locator('#app-shell').isVisible(), false, '無効なセッションでは台帳画面を表示しません');
  await staleSessionPage.close();
  console.log('セッション確認: 再読み込み復元・ログアウト・無効セッション削除を確認しました。');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((resolve) => previewServer.close(resolve));
}
