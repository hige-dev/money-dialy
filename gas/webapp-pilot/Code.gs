const FAMILY_TABLES_ = {
  users: { name: 'Users', headers: ['email', 'name', 'role', 'defaultMemberId', 'active', 'updatedBy', 'updatedAt'] },
  members: { name: 'Members', headers: ['id', 'name', 'active', 'createdAt', 'updatedAt'] },
  sources: { name: 'PaymentSources', headers: ['id', 'name', 'walletEnabled', 'active', 'createdAt', 'updatedAt'] },
  categories: { name: 'Categories', headers: ['id', 'name', 'active', 'createdAt', 'updatedAt'] },
  places: { name: 'Places', headers: ['id', 'name', 'active', 'createdAt', 'updatedAt'] },
  expenses: { name: 'Expenses', headers: ['id', 'date', 'memberId', 'sourceId', 'categoryId', 'amount', 'memo', 'placeId', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt', 'requestId', 'requestHash'] },
  wallet: { name: 'WalletHistory', headers: ['id', 'sourceId', 'date', 'type', 'amount', 'memo', 'createdBy', 'createdAt', 'requestId', 'requestHash'] },
  requests: { name: 'Requests', headers: ['requestId', 'operation', 'recordId', 'requestHash', 'resultJson', 'createdAt', 'status', 'targetRecordId', 'previousStateHash', 'updatedAt', 'payloadJson'] },
  budget: { name: 'Budget', headers: ['id', 'month', 'amount', 'updatedBy', 'updatedAt'] },
  fixedCosts: { name: 'FixedCosts', headers: ['id', 'name', 'amount', 'day', 'frequency', 'categoryId', 'sourceId', 'placeId', 'note', 'active', 'updatedBy', 'updatedAt'] },
  emailRules: { name: 'EmailRules', headers: ['id', 'conditionType', 'condition', 'sourceId', 'categoryId', 'placeId', 'active', 'updatedBy', 'updatedAt'] },
};

const FAMILY_WEB_OAUTH_CLIENT_ID_ = '971274774993-0qpfrqc5i8ct48kq5r2sb7sa7h5s4pou.apps.googleusercontent.com';
const FAMILY_WEB_OAUTH_REDIRECT_URI_ = 'https://script.google.com/macros/d/1zhqVIRy5YKrDURd77Tl5I4Za4f-1kvGqyJbvwnesW1HLFt8j7InXa3sQ/usercallback';
const FAMILY_GOOGLE_AUTHORIZATION_URL_ = 'https://accounts.google.com/o/oauth2/v2/auth';
const FAMILY_GOOGLE_TOKEN_URL_ = 'https://oauth2.googleapis.com/token';
const FAMILY_WEBAPP_SESSION_GENERATION_ = '6';
const FAMILY_WEBAPP_SESSION_PROPERTY_PREFIX_ = 'FAMILY_WEBAPP_SESSION_';

const FAMILY_SEED_ = {
  members: [
    { id: 'member-self', name: '自分' },
    { id: 'member-partner', name: 'パートナー' },
    { id: 'member-family', name: '共通／家族' },
  ],
  sources: [
    { id: 'source-partner-cash', name: 'パートナー現金', walletEnabled: true },
    { id: 'source-family-card', name: '家族カード', walletEnabled: false },
  ],
  categories: ['食費', '日用品', '交通', '交際費', '趣味・娯楽', '住居', '通信費', 'その他']
    .map((name, index) => ({ id: 'category-' + (index + 1), name: name })),
  places: ['スーパー', 'オンライン', '口座振替']
    .map((name, index) => ({ id: 'place-' + (index + 1), name: name })),
};

function doGet() {
  Logger.log('doGet: 画面要求を受け付けました。');
  try {
    Logger.log('doGet: ログイン画面を生成します。');
    const page = renderFamilyPage_({ logContext: 'doGet' });
    Logger.log('doGet: ログイン画面を返します。');
    return page;
  } catch (error) {
    Logger.log('doGet: ログイン画面の生成に失敗しました。');
    throw new Error('画面を表示できませんでした。');
  }
}

/** 一時的なエディタ用関数から呼び出し、必要なGoogleサービスの承認を確認する。 */
function authorizeFamilyLedgerServices_() {
  ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  const effectiveUserEmail = Session.getEffectiveUser().getEmail();
  if (typeof effectiveUserEmail !== 'string' || !effectiveUserEmail.trim()) {
    throw new Error('実行アカウントのメールアドレスを確認できません。Apps Scriptエディタで所有者として実行してください。');
  }

  verifyFamilyScriptPropertiesWriteAccess_(PropertiesService.getScriptProperties());
  getFamilySpreadsheet_();

  const certsResponse = UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v3/certs', {
    muteHttpExceptions: true,
  });
  if (certsResponse.getResponseCode() !== 200) {
    throw new Error('Google認証用の公開鍵に接続できませんでした。必要な承認とネットワーク設定を確認してください。');
  }

  const nonce = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  ScriptApp.newStateToken()
    .withMethod('authCallback')
    .withArgument('nonce', nonce)
    .withTimeout(60)
    .createToken();

  const message = '宣言済みスコープと実行アカウントの承認確認が完了しました。メールアドレスは保存せず、台帳と設定値も変更していません。';
  Logger.log(message);
  return message;
}

function verifyFamilyScriptPropertiesWriteAccess_(properties) {
  let propertyKey = '';
  let existingValue;
  do {
    propertyKey = 'FAMILY_WEBAPP_AUTH_PROBE_' + Utilities.getUuid().replace(/-/g, '');
    existingValue = properties.getProperty(propertyKey);
  } while (existingValue !== null && existingValue !== undefined);

  const probeValue = Utilities.getUuid().replace(/-/g, '');
  let writeError = null;
  try {
    properties.setProperty(propertyKey, probeValue);
    if (properties.getProperty(propertyKey) !== probeValue) throw new Error('一時確認値を読み戻せませんでした。');
  } catch (error) {
    writeError = error;
  }

  let cleanupError = null;
  try { properties.deleteProperty(propertyKey); }
  catch (error) { cleanupError = error; }
  if (cleanupError) throw new Error('スクリプトプロパティの一時確認情報を削除できませんでした。必要な承認を確認してください。');

  let remainingValue;
  try { remainingValue = properties.getProperty(propertyKey); }
  catch (error) { throw new Error('スクリプトプロパティの一時確認情報を確認できませんでした。必要な承認を確認してください。'); }
  if (remainingValue !== null && remainingValue !== undefined) {
    throw new Error('スクリプトプロパティの一時確認情報を削除できませんでした。管理者がScript Propertiesを確認してください。');
  }
  if (writeError) throw new Error('スクリプトプロパティへの書き込みを確認できませんでした。必要な承認を確認してください。');
}

function authCallback(request) {
  Logger.log('authCallback: Googleからの認証応答を受け付けました。');
  const parameters = request && request.parameter || {};
  if (parameters.error) {
    Logger.log('authCallback: Google認証の拒否応答を受け取りました。');
    return renderCallbackResultPage_({ loginMessage: parameters.error === 'access_denied'
      ? 'Googleログインがキャンセルされました。'
      : 'Googleログインを完了できませんでした。もう一度お試しください。' });
  }

  let stage = 'input';
  try {
    if (!parameters.code) throw new Error('Googleログインの認証コードを受け取れませんでした。最初からやり直してください。');
    if (!parameters.nonce) throw new Error('Googleログインの要求を確認できませんでした。最初からやり直してください。');
    Logger.log('authCallback: コールバック要求の形式を確認しました。');

    stage = 'exchange';
    const idToken = exchangeGoogleAuthorizationCode_(String(parameters.code));
    Logger.log('authCallback: 認証コードの交換が完了しました。');

    stage = 'token';
    const claims = verifyGoogleIdToken_(idToken, String(parameters.nonce));
    Logger.log('authCallback: IDトークンを検証しました。');

    stage = 'allowlist';
    const user = authorizeClaims_(claims, false);
    Logger.log('authCallback: Usersシートの利用許可を確認しました。');

    stage = 'session';
    const sessionId = issueFamilySession_(user.email);
    Logger.log('authCallback: アプリセッションを発行しました。');

    stage = 'render';
    const page = renderCallbackResultPage_({ initialSessionId: sessionId, loginMessage: 'ログインを確認しています。' });
    Logger.log('authCallback: 認証済み画面を返します。');
    return page;
  } catch (error) {
    Logger.log(authCallbackFailureLogMessage_(stage));
    return renderCallbackResultPage_({ loginMessage: callbackErrorMessage_(error) });
  }
}

function authCallbackFailureLogMessage_(stage) {
  const messages = {
    input: 'authCallback: コールバック要求の確認に失敗しました。',
    exchange: 'authCallback: 認証コードの交換に失敗しました。',
    token: 'authCallback: IDトークンの検証に失敗しました。',
    allowlist: 'authCallback: Usersシートの利用許可確認に失敗しました。',
    session: 'authCallback: アプリセッションの発行に失敗しました。',
    render: 'authCallback: 認証結果画面の生成に失敗しました。',
  };
  return messages[stage] || 'authCallback: ログイン処理に失敗しました。';
}

function renderCallbackResultPage_(options) {
  try {
    return renderFamilyPage_(Object.assign({}, options, { logContext: 'authCallback' }));
  } catch (error) {
    Logger.log('authCallback: ログイン結果画面の生成に失敗しました。');
    throw new Error('ログイン結果を表示できませんでした。');
  }
}

function renderFamilyPage_(options) {
  const settings = options || {};
  const logContext = settings.logContext === 'authCallback' ? 'authCallback' : 'doGet';
  const template = HtmlService.createTemplateFromFile('Index');
  template.deploymentGeneration = FAMILY_WEBAPP_SESSION_GENERATION_;
  template.initialSessionId = settings.initialSessionId || '';
  template.loginMessage = settings.loginMessage || '';
  template.loginUrl = '';
  try {
    template.loginUrl = googleAuthorizationUrl_();
  } catch (error) {
    Logger.log(logContext + ': Googleログインリンクの生成に失敗しました。');
    if (!template.loginMessage) template.loginMessage = '管理者のログイン設定が完了していません。管理者にお問い合わせください。';
  }
  if (!template.loginMessage) template.loginMessage = '登録済みのGoogleアカウントでログインしてください。';
  return template.evaluate()
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setTitle('Money Diary | 家族の家計簿');
}

function googleAuthorizationUrl_() {
  getScriptProperty_('GOOGLE_OAUTH_CLIENT_SECRET', true);
  const nonce = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const state = ScriptApp.newStateToken()
    .withMethod('authCallback')
    .withArgument('nonce', nonce)
    .withTimeout(300)
    .createToken();
  const parameters = {
    client_id: googleOAuthClientId_(),
    redirect_uri: FAMILY_WEB_OAUTH_REDIRECT_URI_,
    response_type: 'code',
    scope: 'openid email',
    state: state,
    nonce: nonce,
  };
  return FAMILY_GOOGLE_AUTHORIZATION_URL_ + '?' + Object.keys(parameters).map(function (key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(parameters[key]);
  }).join('&');
}

function exchangeGoogleAuthorizationCode_(authorizationCode) {
  let response;
  try {
    response = UrlFetchApp.fetch(FAMILY_GOOGLE_TOKEN_URL_, {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: {
        code: authorizationCode,
        client_id: googleOAuthClientId_(),
        client_secret: getScriptProperty_('GOOGLE_OAUTH_CLIENT_SECRET', true),
        redirect_uri: FAMILY_WEB_OAUTH_REDIRECT_URI_,
        grant_type: 'authorization_code',
      },
      muteHttpExceptions: true,
    });
  } catch (error) {
    throw new Error('Googleとの認証コード交換に失敗しました。もう一度ログインしてください。');
  }
  if (response.getResponseCode() !== 200) throw new Error('Googleとの認証コード交換に失敗しました。OAuth設定を確認してください。');
  let tokenResponse;
  try { tokenResponse = JSON.parse(response.getContentText()); }
  catch (error) { throw new Error('Googleのログイン応答を読み取れませんでした。'); }
  if (!tokenResponse || typeof tokenResponse.id_token !== 'string' || !tokenResponse.id_token) {
    throw new Error('Googleのログイン応答にIDトークンがありません。');
  }
  return tokenResponse.id_token;
}

function callbackErrorMessage_(error) {
  const message = String(error && error.message || '');
  const safeMessages = [
    'Googleログインの認証コードを受け取れませんでした。最初からやり直してください。',
    'Googleログインの要求を確認できませんでした。最初からやり直してください。',
    'Googleとの認証コード交換に失敗しました。もう一度ログインしてください。',
    'Googleとの認証コード交換に失敗しました。OAuth設定を確認してください。',
    'Googleのログイン応答を読み取れませんでした。',
    'Googleのログイン応答にIDトークンがありません。',
    'Googleログイン情報のnonceが一致しません。最初からやり直してください。',
    'Googleログイン情報の宛先が正しくありません。',
    'Googleログイン情報の有効期限が切れています。ログインし直してください。',
    'このGoogleアカウントは利用を許可されていません。',
  ];
  if (safeMessages.indexOf(message) >= 0) return message;
  if (message.indexOf('Googleログイン情報') === 0 || message.indexOf('確認済みのGoogleアカウント情報') === 0) return message;
  return 'Googleログインを確認できませんでした。OAuth設定を確認して、もう一度お試しください。';
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** 初回設定時に、Usersシートへ登録した管理者だけが呼び出せる冪等な初期化処理。 */
function initializeFamilyLedger(sessionId) {
  const actor = authorizeSession_(sessionId, true);
  const spreadsheet = getFamilySpreadsheet_();
  Object.keys(FAMILY_TABLES_).forEach(function (key) {
    ensureTable_(spreadsheet, FAMILY_TABLES_[key]);
  });
  seedTable_('members', FAMILY_SEED_.members, actor.email);
  seedTable_('sources', FAMILY_SEED_.sources, actor.email);
  seedTable_('categories', FAMILY_SEED_.categories, actor.email);
  seedTable_('places', FAMILY_SEED_.places, actor.email);
  return getAppData(sessionId);
}

/** ブラウザーから渡されたセッションを失効させる。台帳データにはアクセスしない。 */
function logoutFamilySession(sessionId) {
  const propertyKey = familySessionPropertyKey_(sessionId);
  const properties = PropertiesService.getScriptProperties();
  const storedSession = properties.getProperty(propertyKey);
  if (!storedSession) throw new Error('アプリのログイン状態が無効です。もう一度Googleログインしてください。');
  let session;
  try { session = JSON.parse(storedSession); } catch (error) { session = null; }
  if (!session || session.generation !== FAMILY_WEBAPP_SESSION_GENERATION_ || !session.email) {
    properties.deleteProperty(propertyKey);
    throw new Error('アプリのログイン状態が無効です。もう一度Googleログインしてください。');
  }
  try {
    authorizeClaims_({ email: session.email }, false);
  } finally {
    properties.deleteProperty(propertyKey);
  }
  return { loggedOut: true };
}

function getAppData(sessionId) {
  const actor = authorizeSession_(sessionId, false);
  const missingTables = Object.keys(FAMILY_TABLES_)
    .map(function (key) { return FAMILY_TABLES_[key].name; })
    .filter(function (name) { return !getFamilySpreadsheet_().getSheetByName(name); });
  if (missingTables.length) {
    if (actor.role === 'admin') return { setupRequired: true, user: publicUser_(actor), missingTables: missingTables };
    throw new Error('管理者による初期設定が完了していません。');
  }

  recoverPendingExpenseOperations_();

  const data = {
    setupRequired: false,
    user: publicUser_(actor),
    members: readTable_('members'),
    sources: readTable_('sources'),
    categories: readTable_('categories'),
    places: readTable_('places'),
    expenses: readTable_('expenses'),
    walletEntries: readTable_('wallet'),
    budget: readTable_('budget').find(function (row) { return row.month === '*'; }) || null,
    fixedCosts: readTable_('fixedCosts'),
    emailRules: readTable_('emailRules'),
    users: actor.role === 'admin' ? readTable_('users').map(publicUser_) : [],
  };
  data.sources = addWalletBalances_(data.sources, data.walletEntries, data.expenses);
  return data;
}

function saveExpense(sessionId, input) {
  const actor = authorizeSession_(sessionId, false);
  const expense = validateExpenseInput_(input);
  const requestId = requiredRequestId_(input.requestId);
  const tables = {
    members: readTable_('members'),
    sources: readTable_('sources'),
    categories: readTable_('categories'),
    places: readTable_('places'),
  };
  requireActiveReference_(tables.members, expense.memberId, '利用者');
  requireActiveReference_(tables.sources, expense.sourceId, '支払元');
  const category = requireActiveReference_(tables.categories, expense.categoryId, 'カテゴリ');
  if (category.name === '収入') throw new Error('家族用帳簿には収入を登録できません。');
  if (expense.placeId) requireActiveReference_(tables.places, expense.placeId, '場所');
  const fingerprintPayload = {
    id: expense.id, date: expense.date, memberId: expense.memberId, sourceId: expense.sourceId,
    categoryId: expense.categoryId, amount: expense.amount, memo: expense.memo, placeId: expense.placeId, createdBy: actor.email,
  };
  const requestHash = requestFingerprint_('expense', fingerprintPayload);
  return withIdempotentWrite_('expenses', requestId, 'expense', requestHash, function () {
    const existing = expense.id ? findById_('expenses', expense.id) : null;
    if (expense.id && !existing) throw new Error('更新対象の支出が見つかりません。');
    const now = new Date().toISOString();
    const record = {
      id: existing ? existing.id : Utilities.getUuid(),
      date: expense.date,
      memberId: expense.memberId,
      sourceId: expense.sourceId,
      categoryId: expense.categoryId,
      amount: expense.amount,
      memo: expense.memo,
      placeId: expense.placeId,
      createdBy: existing ? existing.createdBy : actor.email,
      createdAt: existing ? existing.createdAt : now,
      updatedBy: actor.email,
      updatedAt: now,
      requestId: requestId,
      requestHash: requestHash,
    };
    writeTableRecordUnlocked_('expenses', record);
    return record;
  }, { targetRecordId: expense.id, payloadJson: JSON.stringify(fingerprintPayload) });
}

function deleteExpense(sessionId, id) {
  authorizeSession_(sessionId, false);
  return withWriteLock_(function () {
    if (!id || !findById_('expenses', id)) throw new Error('削除対象の支出が見つかりません。');
    const blocker = findExpenseOperationBlocker_(id);
    if (blocker && blocker.status === 'needsReview') throw needsReviewExpenseError_();
    if (blocker) throw new Error('この支出には結果未確定の保存要求があります。同じ要求IDで再送して完了を確認してから削除してください。');
    deleteTableRecordUnlocked_('expenses', id);
    return { id: id };
  });
}

function saveMaster(sessionId, type, input) {
  const actor = authorizeSession_(sessionId, true);
  const config = masterConfig_(type);
  input = input || {};
  const name = normalizeText_(input.name, '名前', 80);
  if (type === 'categories' && name === '収入') throw new Error('家族用帳簿には収入カテゴリを登録できません。');
  const id = input && input.id ? String(input.id) : Utilities.getUuid();
  const existing = input && input.id ? findById_(type, id) : null;
  if (input && input.id && !existing) throw new Error('更新対象の設定が見つかりません。');
  if (readTable_(type).some(function (row) { return row.id !== id && row.name.toLowerCase() === name.toLowerCase(); })) {
    throw new Error('同じ名前はすでに登録されています。');
  }
  const now = new Date().toISOString();
  const record = {
    id: id,
    name: name,
    active: input.active === undefined ? true : Boolean(input.active),
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };
  if (type === 'sources') {
    record.walletEnabled = Boolean(input.walletEnabled);
  }
  if (type === 'members' && !record.active) {
    if (readTable_('users').some(function (user) { return boolValue_(user.active) && user.defaultMemberId === id; })) {
      throw new Error('有効ユーザーの既定利用者に設定されているため停止できません。');
    }
    if (readTable_('expenses').some(function (expense) { return expense.memberId === id; })) {
      throw new Error('支出で使用されているため停止できません。');
    }
  }
  if (type === 'sources' && !record.active && readTable_('expenses').some(function (expense) { return expense.sourceId === id; })) {
    throw new Error('支出で使用されているため停止できません。');
  }
  if (type === 'categories' && !record.active && readTable_('expenses').some(function (expense) { return expense.categoryId === id; })) {
    throw new Error('支出で使用されているため停止できません。');
  }
  if (type === 'places' && !record.active && readTable_('expenses').some(function (expense) { return expense.placeId === id; })) {
    throw new Error('支出で使用されているため停止できません。');
  }
  if (type === 'sources' && record.walletEnabled && !(existing && existing.walletEnabled)) {
    const initialAmount = input.openingBalance === undefined || input.openingBalance === '' ? 0 : integerAmount_(input.openingBalance, '初期残高', true);
    ensureOpeningWalletEntry_({
      id: Utilities.getUuid(), sourceId: id, date: localDate_(new Date()), type: 'opening',
      amount: initialAmount, memo: '初期残高', createdBy: actor.email, createdAt: now,
    });
  }
  writeTableRecord_(type, record);
  return record;
}

function setMasterActive(sessionId, type, id, active) {
  const actor = authorizeSession_(sessionId, true);
  const config = masterConfig_(type);
  const record = findById_(type, id);
  if (!record) throw new Error('更新対象の設定が見つかりません。');
  return saveMaster(sessionId, type, Object.assign({}, record, { active: Boolean(active) }));
}

function saveUser(sessionId, input) {
  const actor = authorizeSession_(sessionId, true);
  const email = normalizeText_(input && input.email, 'メールアドレス', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Googleアカウントのメールアドレスを入力してください。');
  const name = normalizeText_(input && input.name, '表示名', 80);
  const role = String(input && input.role || 'member');
  if (role !== 'admin' && role !== 'member') throw new Error('権限の値が正しくありません。');
  const defaultMemberId = String(input && input.defaultMemberId || '');
  requireActiveReference_(readTable_('members'), defaultMemberId, '既定利用者');
  const users = readTable_('users');
  const originalEmail = String(input && input.originalEmail || '').toLowerCase();
  const originalUser = originalEmail ? users.find(function (user) { return String(user.email).toLowerCase() === originalEmail; }) : null;
  if (originalEmail && !originalUser) throw new Error('更新対象のユーザーが見つかりません。画面を更新してからもう一度お試しください。');
  const existing = originalUser || users.find(function (user) { return String(user.email).toLowerCase() === email; });
  if (users.some(function (user) { return user !== existing && String(user.email).toLowerCase() === email; })) {
    throw new Error('このメールアドレスはすでに登録されています。');
  }
  const active = input.active === undefined ? true : Boolean(input.active);
  const allUsers = users;
  if (existing && existing.role === 'admin' && (role !== 'admin' || !active) && allUsers.filter(function (user) {
    return String(user.role) === 'admin' && boolValue_(user.active) && user !== existing;
  }).length === 0) {
    throw new Error('最後の管理者は停止または一般ユーザーへ変更できません。');
  }
  const now = new Date().toISOString();
  const user = { email: email, name: name, role: role, defaultMemberId: defaultMemberId, active: active, updatedBy: actor.email, updatedAt: now };
  if (existing && String(existing.email).toLowerCase() !== email) {
    withWriteLock_(function () {
      const usersSheet = getFamilySpreadsheet_().getSheetByName(FAMILY_TABLES_.users.name);
      const rows = usersSheet.getRange(2, 1, usersSheet.getLastRow() - 1, FAMILY_TABLES_.users.headers.length).getValues();
      const rowIndex = rows.findIndex(function (row) { return String(row[0]).toLowerCase() === String(existing.email).toLowerCase(); });
      if (rowIndex < 0) throw new Error('更新対象のユーザーが見つかりません。');
      writeRowValues_(usersSheet, rowIndex + 2, FAMILY_TABLES_.users, user);
    });
  } else {
    writeTableRecord_('users', user, 'email');
  }
  return publicUser_(user);
}

function addWalletTopUp(sessionId, input) {
  const actor = authorizeSession_(sessionId, true);
  const sourceId = String(input && input.sourceId || '');
  const source = requireActiveReference_(readTable_('sources'), sourceId, '支払元');
  if (!boolValue_(source.walletEnabled)) throw new Error('この支払元では財布残高を管理していません。');
  const amount = integerAmount_(input.amount, '補充額', false);
  const date = validateDate_(input.date);
  const memo = normalizeText_(input.memo || '補充', 'メモ', 200);
  const requestId = requiredRequestId_(input.requestId);
  const requestHash = requestFingerprint_('walletTopUp', {
    sourceId: sourceId, date: date, amount: amount, memo: memo, createdBy: actor.email,
  });
  return withIdempotentWrite_('wallet', requestId, 'walletTopUp', requestHash, function () {
    const record = {
      id: Utilities.getUuid(), sourceId: sourceId, date: date, type: 'topup', amount: amount,
      memo: memo, createdBy: actor.email, createdAt: new Date().toISOString(), requestId: requestId, requestHash: requestHash,
    };
    writeTableRecordUnlocked_('wallet', record);
    return record;
  });
}

function saveBudget(sessionId, amount) {
  const actor = authorizeSession_(sessionId, true);
  const id = 'family-monthly-budget';
  const record = {
    id: id, month: '*', amount: amount === '' || amount === null ? 0 : integerAmount_(amount, '月予算', true),
    updatedBy: actor.email, updatedAt: new Date().toISOString(),
  };
  if (record.amount === 0) {
    deleteTableRecord_('budget', id);
    return null;
  }
  writeTableRecord_('budget', record);
  return record;
}

function saveSettingRecord(sessionId, type, input) {
  const actor = authorizeSession_(sessionId, true);
  const table = type === 'fixedCosts' ? 'fixedCosts' : type === 'emailRules' ? 'emailRules' : '';
  if (!table) throw new Error('設定の種類が正しくありません。');
  const record = normalizeSettingRecord_(table, input);
  const existing = record.id ? findById_(table, record.id) : null;
  if (record.id && !existing) throw new Error('更新対象の設定が見つかりません。');
  record.id = existing ? existing.id : Utilities.getUuid();
  if (existing && table === 'fixedCosts') record.active = existing.active;
  if (existing && table === 'emailRules') record.active = existing.active;
  record.updatedBy = actor.email;
  record.updatedAt = new Date().toISOString();
  writeTableRecord_(table, record);
  return record;
}

function deleteSettingRecord(sessionId, type, id) {
  authorizeSession_(sessionId, true);
  const table = type === 'fixedCosts' ? 'fixedCosts' : type === 'emailRules' ? 'emailRules' : '';
  if (!table) throw new Error('設定の種類が正しくありません。');
  if (!findById_(table, id)) throw new Error('削除対象の設定が見つかりません。');
  deleteTableRecord_(table, id);
  return { id: id };
}

function transformLegacyBackupRows_(rows, nonExpenseCategoryNames) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('バックアップに見出し行がありません。');
  const headers = rows[0].map(function (value) { return String(value || '').trim().toLowerCase(); });
  const required = ['id', 'date', 'payer', 'category', 'amount', 'memo', 'place', 'createdby', 'createdat', 'updatedat', 'visibility'];
  if (required.some(function (header) { return headers.indexOf(header) < 0; })) throw new Error('バックアップの列見出しが想定と異なります。');
  const indexes = {};
  headers.forEach(function (header, index) { indexes[header] = index; });
  const excludedCategories = new Set(['収入'].concat(Array.isArray(nonExpenseCategoryNames) ? nonExpenseCategoryNames.map(String) : []));
  const result = { rows: [], skippedVisibility: 0, skippedIncome: 0, skippedNonExpense: 0, skippedInvalid: 0 };
  rows.slice(1).forEach(function (row) {
    if (!row || row.every(function (value) { return value === '' || value === null || value === undefined; })) return;
    const visibilityCell = row[indexes.visibility];
    const visibility = visibilityCell === null || visibilityCell === undefined || visibilityCell === '' ? '' : String(visibilityCell);
    if (visibility !== '' && visibility !== 'public') {
      result.skippedVisibility += 1;
      return;
    }
    const category = String(row[indexes.category] || '').trim();
    if (excludedCategories.has(category)) {
      if (category === '収入') result.skippedIncome += 1;
      result.skippedNonExpense += 1;
      return;
    }
    const amount = Number(String(row[indexes.amount] || '').replace(/,/g, ''));
    if (!row[indexes.id] || !isDateValue_(row[indexes.date]) || !category || !Number.isSafeInteger(amount) || amount <= 0) {
      result.skippedInvalid += 1;
      return;
    }
    result.rows.push({
      id: String(row[indexes.id]),
      date: normalizeLegacyDate_(row[indexes.date]),
      legacyPayer: String(row[indexes.payer] || '').trim(),
      memberName: '自分',
      categoryName: category,
      amount: amount,
      memo: String(row[indexes.memo] || ''),
      placeName: String(row[indexes.place] || ''),
      createdBy: String(row[indexes.createdby] || ''),
      createdAt: String(row[indexes.createdat] || ''),
      updatedAt: String(row[indexes.updatedat] || ''),
    });
  });
  return result;
}

function issueFamilySession_(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) throw new Error('確認済みのGoogleアカウント情報がありません。');
  const properties = PropertiesService.getScriptProperties();
  removeObsoleteFamilySessions_(properties);
  let sessionId = '';
  let propertyKey = '';
  do {
    sessionId = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    propertyKey = familySessionPropertyKey_(sessionId);
  } while (properties.getProperty(propertyKey));
  properties.setProperty(propertyKey, JSON.stringify({
    email: normalizedEmail,
    generation: FAMILY_WEBAPP_SESSION_GENERATION_,
    createdAt: new Date().toISOString(),
  }));
  return sessionId;
}

function removeObsoleteFamilySessions_(properties) {
  const allProperties = properties.getProperties();
  Object.keys(allProperties).forEach(function (key) {
    if (key.indexOf(FAMILY_WEBAPP_SESSION_PROPERTY_PREFIX_) !== 0) return;
    let session;
    try { session = JSON.parse(allProperties[key]); } catch (error) { session = null; }
    if (!session || session.generation !== FAMILY_WEBAPP_SESSION_GENERATION_) properties.deleteProperty(key);
  });
}

function familySessionPropertyKey_(sessionId) {
  if (typeof sessionId !== 'string' || !/^[a-f0-9]{96}$/i.test(sessionId)) {
    throw new Error('アプリのログイン状態が無効です。もう一度Googleログインしてください。');
  }
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sessionId, Utilities.Charset.UTF_8);
  return FAMILY_WEBAPP_SESSION_PROPERTY_PREFIX_ + bytesToHex_(digest);
}

function authorizeSession_(sessionId, adminRequired) {
  const propertyKey = familySessionPropertyKey_(sessionId);
  const properties = PropertiesService.getScriptProperties();
  const storedSession = properties.getProperty(propertyKey);
  if (!storedSession) throw new Error('アプリのログイン状態が無効です。もう一度Googleログインしてください。');
  let session;
  try { session = JSON.parse(storedSession); } catch (error) { session = null; }
  if (!session || session.generation !== FAMILY_WEBAPP_SESSION_GENERATION_ || !session.email) {
    properties.deleteProperty(propertyKey);
    throw new Error('アプリのログイン状態が無効です。もう一度Googleログインしてください。');
  }
  return authorizeClaims_({ email: session.email }, adminRequired);
}

function authorizeClaims_(claims, adminRequired) {
  const email = String(claims.email).toLowerCase();
  const usersSheet = getFamilySpreadsheet_().getSheetByName(FAMILY_TABLES_.users.name);
  if (!usersSheet) throw new Error('Usersシートがありません。管理者が初期登録手順を完了してください。');
  const user = readTable_('users').find(function (row) { return String(row.email).toLowerCase() === email; });
  if (!user || !boolValue_(user.active)) throw new Error('このGoogleアカウントは利用を許可されていません。');
  if (adminRequired && user.role !== 'admin') throw new Error('この操作は管理者だけが実行できます。');
  return Object.assign({}, user, { email: email });
}

function verifyGoogleIdToken_(idToken, expectedNonce) {
  if (typeof idToken !== 'string' || idToken.length < 100 || idToken.length > 10000) throw new Error('Googleログイン情報を確認できません。ログインし直してください。');
  const clientId = googleOAuthClientId_();
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Googleログイン情報の形式が正しくありません。');
  const header = parseBase64UrlJson_(parts[0]);
  const claims = parseBase64UrlJson_(parts[1]);
  if (header.alg !== 'RS256' || !header.kid || header.crit || header.b64 === false) throw new Error('Googleログイン情報の署名形式を受け付けられません。');
  if (!verifyGoogleSignature_(parts[0] + '.' + parts[1], parts[2], String(header.kid))) throw new Error('Googleログイン情報の署名を確認できません。');
  const now = Math.floor(Date.now() / 1000);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') throw new Error('Googleログイン情報の発行元が正しくありません。');
  if (audience.indexOf(clientId) < 0 || (claims.azp && claims.azp !== clientId)) throw new Error('Googleログイン情報の宛先が正しくありません。');
  if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= now - 60) throw new Error('Googleログイン情報の有効期限が切れています。ログインし直してください。');
  if (!Number.isFinite(Number(claims.iat)) || Number(claims.iat) > now + 60 || Number(claims.iat) < now - 7200) throw new Error('Googleログイン情報の発行時刻が正しくありません。');
  if (!claims.sub || !claims.email || String(claims.email_verified).toLowerCase() !== 'true') throw new Error('確認済みのGoogleアカウント情報がありません。');
  if (expectedNonce !== undefined && (!expectedNonce || claims.nonce !== expectedNonce)) throw new Error('Googleログイン情報のnonceが一致しません。最初からやり直してください。');
  return claims;
}

function verifyGoogleSignature_(message, encodedSignature, keyId) {
  const jwk = getGoogleJwk_(keyId);
  if (!jwk || jwk.kty !== 'RSA' || jwk.alg && jwk.alg !== 'RS256' || jwk.use && jwk.use !== 'sig') return false;
  const modulusBytes = base64UrlBytes_(jwk.n);
  const exponentBytes = base64UrlBytes_(jwk.e);
  if (modulusBytes.length < 256 || modulusBytes.length > 1024 || !exponentBytes.length || exponentBytes.length > 4) return false;
  const modulus = bytesToBigInt_(modulusBytes);
  const exponent = bytesToBigInt_(exponentBytes);
  const signature = base64UrlBytes_(encodedSignature);
  const modulusLength = modulusBytes.length;
  if (signature.length !== modulusLength) return false;
  const signatureValue = bytesToBigInt_(signature);
  if (signatureValue >= modulus) return false;
  const decoded = bigIntToBytes_(modularPower_(signatureValue, exponent, modulus), modulusLength);
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, message, Utilities.Charset.UTF_8);
  const digestHex = bytesToHex_(digest);
  const expectedDigestInfo = '3031300d060960864801650304020105000420' + digestHex;
  const encodedMessage = bytesToHex_(decoded);
  const suffix = '00' + expectedDigestInfo;
  if (encodedMessage.slice(0, 4) !== '0001' || !encodedMessage.endsWith(suffix)) return false;
  const padding = encodedMessage.slice(4, encodedMessage.length - suffix.length);
  return padding.length >= 16 && /^ff+$/.test(padding);
}

function getGoogleJwk_(keyId) {
  let keys = readCachedGoogleJwks_();
  let key = keys && keys.keys && keys.keys.find(function (item) { return item.kid === keyId; });
  if (key) return key;
  keys = fetchGoogleJwks_(true);
  return keys.keys.find(function (item) { return item.kid === keyId; }) || null;
}

function readCachedGoogleJwks_() {
  const cached = CacheService.getScriptCache().get('google-id-token-jwks-v1');
  if (!cached) return null;
  try { return JSON.parse(cached); } catch (error) { return null; }
}

function fetchGoogleJwks_(forceRefresh) {
  const cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    const cached = readCachedGoogleJwks_();
    if (cached) return cached;
  }
  const response = UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v3/certs', { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('Google公開鍵を取得できないため、ログインを確認できません。');
  const body = JSON.parse(response.getContentText());
  if (!Array.isArray(body.keys) || !body.keys.length) throw new Error('Google公開鍵の形式を確認できません。');
  const maxAgeMatch = String(getHeader_(response.getAllHeaders(), 'Cache-Control') || '').match(/max-age=(\d+)/i);
  const maxAge = maxAgeMatch ? Math.min(Number(maxAgeMatch[1]), 21600) : 0;
  if (maxAge > 0) cache.put('google-id-token-jwks-v1', JSON.stringify(body), maxAge);
  return body;
}

function modularPower_(base, exponent, modulus) {
  const zero = BigInt(0);
  const one = BigInt(1);
  const two = BigInt(2);
  if (modulus <= zero) throw new Error('RSA公開鍵が正しくありません。');
  let result = one;
  let factor = base % modulus;
  let power = exponent;
  while (power > zero) {
    if (power % two === one) result = result * factor % modulus;
    power = power / two;
    factor = factor * factor % modulus;
  }
  return result;
}

function parseBase64UrlJson_(segment) {
  try { return JSON.parse(Utilities.newBlob(base64UrlBytes_(segment)).getDataAsString('UTF-8')); }
  catch (error) { throw new Error('Googleログイン情報を読み取れません。'); }
}

function base64UrlBytes_(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Googleログイン情報の符号化が正しくありません。');
  const standard = value.replace(/-/g, '+').replace(/_/g, '/');
  return Utilities.base64Decode(standard + '='.repeat((4 - standard.length % 4) % 4)).map(function (byte) { return (byte + 256) % 256; });
}

function bytesToBigInt_(bytes) { return BigInt('0x' + bytesToHex_(bytes)); }

function bigIntToBytes_(value, length) {
  let hex = value.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  hex = hex.padStart(length * 2, '0');
  if (hex.length !== length * 2) throw new Error('RSA署名の長さが正しくありません。');
  const bytes = [];
  for (let index = 0; index < hex.length; index += 2) bytes.push(parseInt(hex.slice(index, index + 2), 16));
  return bytes;
}

function bytesToHex_(bytes) {
  return bytes.map(function (byte) { return ((byte + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}

function getHeader_(headers, name) {
  const key = Object.keys(headers || {}).find(function (header) { return header.toLowerCase() === name.toLowerCase(); });
  return key ? headers[key] : '';
}

function getFamilySpreadsheet_() {
  const configuredValue = getScriptProperty_('FAMILY_SPREADSHEET_ID', true);
  const id = normalizeSpreadsheetId_(configuredValue);
  try { return SpreadsheetApp.openById(id); }
  catch (error) { throw new Error('家族用スプレッドシートを開けません。設定値と管理者の権限を確認してください。'); }
}

function normalizeSpreadsheetId_(value) {
  const configuredValue = String(value || '').trim();
  const urlMatch = configuredValue.match(/^https:\/\/docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)(?:[\/?#]|$)/i);
  if (urlMatch) return urlMatch[1];
  if (/^https?:\/\//i.test(configuredValue)) {
    throw new Error('FAMILY_SPREADSHEET_IDにはスプレッドシートのID、またはdocs.google.comのURLを設定してください。');
  }
  return configuredValue;
}

function getScriptProperty_(key, required) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value && required) throw new Error('管理者設定 ' + key + ' がありません。READMEの初期設定を確認してください。');
  return value || '';
}

function googleOAuthClientId_() {
  return getScriptProperty_('GOOGLE_OAUTH_CLIENT_ID', false) || FAMILY_WEB_OAUTH_CLIENT_ID_;
}

function ensureTable_(spreadsheet, table) {
  let sheet = spreadsheet.getSheetByName(table.name);
  if (!sheet) sheet = spreadsheet.insertSheet(table.name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, table.headers.length).setValues([table.headers]);
    sheet.setFrozenRows(1);
    return;
  }
  if (table.name === 'Requests') {
    withWriteLock_(function () { ensureRequestsSchemaUnlocked_(sheet); });
    return;
  }
  const currentHeaders = sheet.getRange(1, 1, 1, table.headers.length).getValues()[0].map(String);
  if (currentHeaders.join('\u0000') !== table.headers.join('\u0000')) throw new Error(table.name + 'シートの列見出しが想定と異なります。データを消さず、管理者が列構成を確認してください。');
}

function ensureRequestsSchemaUnlocked_(sheet) {
  const table = FAMILY_TABLES_.requests;
  const headers = sheet.getRange(1, 1, 1, table.headers.length).getValues()[0].map(String);
  if (headers.join('\u0000') === table.headers.join('\u0000')) return;
  const legacyHeaders = ['requestId', 'operation', 'recordId', 'requestHash', 'resultJson', 'createdAt'];
  const interimHeaders = ['requestId', 'operation', 'recordId', 'requestHash', 'resultJson', 'createdAt', 'status', 'targetRecordId', 'previousStateHash', 'updatedAt'];
  const isLegacy = legacyHeaders.every(function (header, index) { return headers[index] === header; }) &&
    headers.slice(legacyHeaders.length).every(function (header) { return !header; });
  const isInterim = interimHeaders.every(function (header, index) { return headers[index] === header; }) &&
    headers.slice(interimHeaders.length).every(function (header) { return !header; });
  if (!isLegacy && !isInterim) throw new Error('Requestsシートの列見出しが想定と異なります。データを消さず、管理者が列構成を確認してください。');
  sheet.getRange(1, 1, 1, table.headers.length).setValues([table.headers]);
}

function seedTable_(type, records, createdBy) {
  const now = new Date().toISOString();
  records.forEach(function (seed) {
    if (findById_(type, seed.id)) return;
    const record = Object.assign({}, seed, { active: true, createdAt: now, updatedAt: now });
    if (type === 'sources') record.walletEnabled = Boolean(seed.walletEnabled);
    writeTableRecord_(type, record);
  });
  if (type === 'sources') {
    const source = readTable_(type).find(function (item) { return item.id === 'source-partner-cash'; });
    if (source && boolValue_(source.walletEnabled)) {
      ensureOpeningWalletEntry_({
        id: Utilities.getUuid(), sourceId: source.id, date: localDate_(new Date()), type: 'opening', amount: 0,
        memo: '初期残高', createdBy: createdBy, createdAt: now,
      });
    }
  }
}

function readTable_(type) {
  const table = FAMILY_TABLES_[type];
  if (!table) throw new Error('シートの種類が正しくありません。');
  const sheet = getFamilySpreadsheet_().getSheetByName(table.name);
  if (!sheet) return [];
  if (!sheet.getLastRow()) return [];
  const currentHeaders = sheet.getRange(1, 1, 1, table.headers.length).getValues()[0].map(String);
  if (currentHeaders.join('\u0000') !== table.headers.join('\u0000')) throw new Error(table.name + 'シートの列見出しが想定と異なります。管理者が列構成を確認してください。');
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, table.headers.length).getValues();
  return values.filter(function (row) { return row.some(function (cell) { return cell !== '' && cell !== null; }); })
    .map(function (row) {
      const item = {};
      table.headers.forEach(function (header, index) { item[header] = jsonCell_(row[index]); });
      return item;
    });
}

function jsonCell_(value) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function writeTableRecord_(type, record, keyField) {
  const table = FAMILY_TABLES_[type];
  const key = keyField || 'id';
  const value = String(record[key]);
  return withWriteLock_(function () { return writeTableRecordUnlocked_(type, record, key, value); });
}

function writeTableRecordUnlocked_(type, record, keyField, keyValue) {
  const table = FAMILY_TABLES_[type];
  const key = keyField || 'id';
  const value = keyValue === undefined ? String(record[key]) : String(keyValue);
  const sheet = getFamilySpreadsheet_().getSheetByName(table.name);
  const rows = sheet.getLastRow() >= 2 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, table.headers.length).getValues() : [];
  const keyColumn = table.headers.indexOf(key);
  let rowNumber = -1;
  rows.some(function (row, index) {
    if (String(row[keyColumn]).toLowerCase() === value.toLowerCase()) { rowNumber = index + 2; return true; }
    return false;
  });
  if (rowNumber < 0) rowNumber = sheet.getLastRow() + 1;
  writeRowValues_(sheet, rowNumber, table, record);
  return record;
}

function writeRowValues_(sheet, rowNumber, table, record) {
  const values = table.headers.map(function (header) { return record[header] === undefined ? '' : record[header]; });
  const literalIndexes = [];
  const safeValues = values.map(function (value, index) {
    if (typeof value === 'string' && /^[\u0000-\u0020]*[=+\-@]/.test(value)) {
      literalIndexes.push(index);
      return '';
    }
    return value;
  });
  sheet.getRange(rowNumber, 1, 1, table.headers.length).setValues([safeValues]);
  literalIndexes.forEach(function (index) {
    const richText = SpreadsheetApp.newRichTextValue().setText(values[index]).build();
    sheet.getRange(rowNumber, index + 1).setRichTextValue(richText);
  });
}

function ensureOpeningWalletEntry_(record) {
  return withWriteLock_(function () {
    const exists = readTable_('wallet').some(function (entry) { return entry.sourceId === record.sourceId && entry.type === 'opening'; });
    if (exists) return false;
    writeTableRecordUnlocked_('wallet', record);
    return true;
  });
}

function requiredRequestId_(value) {
  const requestId = String(value || '');
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) throw new Error('保存要求IDが正しくありません。画面を再読み込みしてください。');
  return requestId;
}

function requestFingerprint_(operation, payload) {
  const canonicalPayload = operation + '\u0000' + JSON.stringify(payload);
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonicalPayload, Utilities.Charset.UTF_8);
  return digest.map(function (byte) { return ('0' + ((Number(byte) + 256) % 256).toString(16)).slice(-2); }).join('');
}

function recoverPendingExpenseOperations_() {
  return withWriteLock_(recoverPendingExpenseOperationsUnlocked_);
}

function recoverPendingExpenseOperationsUnlocked_() {
  const requestsSheet = getFamilySpreadsheet_().getSheetByName(FAMILY_TABLES_.requests.name);
  if (!requestsSheet) return 0;
  ensureRequestsSchemaUnlocked_(requestsSheet);
  const pending = readTable_('requests').filter(function (request) {
    return request.status === 'pending' && request.operation === 'expense';
  });
  let recoveredCount = 0;
  pending.forEach(function (request) {
    recoverPendingExpenseRequestUnlocked_(request);
    recoveredCount += 1;
  });
  return recoveredCount;
}

function recoverPendingExpenseRequestUnlocked_(request) {
  const requestId = String(request.requestId || '');
  const requestHash = String(request.requestHash || '');
  const targetRecordId = String(request.targetRecordId || '');
  let current = targetRecordId ? findById_('expenses', targetRecordId) : findByField_('expenses', 'requestId', requestId);
  if (current && current.requestId === requestId && current.requestHash === requestHash) {
    writeCompletedRequestUnlocked_(request, current);
    return current;
  }
  if (!String(request.payloadJson || '')) {
    if (targetRecordId && current && request.previousStateHash && expenseRecordStateHash_(current) === request.previousStateHash) {
      writeExpenseRequestTerminalStatusUnlocked_(request, 'notApplied');
      return null;
    }
    writeExpenseRequestTerminalStatusUnlocked_(request, 'needsReview');
    return null;
  }
  if (!targetRecordId && current) {
    throw new Error('同じ保存要求IDの支出台帳行が異なる内容です。台帳を管理者が確認してください。');
  }
  if (targetRecordId && (!current || !request.previousStateHash || expenseRecordStateHash_(current) !== request.previousStateHash)) {
    throw new Error('保留中の支出更新と台帳の内容が一致しません。台帳を管理者が確認してください。');
  }
  if (!current && findByField_('expenses', 'requestId', requestId)) {
    throw new Error('同じ保存要求IDの支出台帳行が異なる内容です。台帳を管理者が確認してください。');
  }
  const payload = normalizedPendingExpensePayload_(request);
  if (targetRecordId && payload.id !== targetRecordId) {
    throw new Error('保留中の支出更新先と保存payloadが一致しません。台帳を管理者が確認してください。');
  }
  if (!targetRecordId && payload.id) {
    throw new Error('保留中の新規支出に更新対象IDがあります。台帳を管理者が確認してください。');
  }
  const now = new Date().toISOString();
  const record = {
    id: current ? current.id : Utilities.getUuid(), date: payload.date, memberId: payload.memberId,
    sourceId: payload.sourceId, categoryId: payload.categoryId, amount: payload.amount, memo: payload.memo,
    placeId: payload.placeId, createdBy: current ? current.createdBy : payload.createdBy,
    createdAt: current ? current.createdAt : now, updatedBy: payload.createdBy, updatedAt: now,
    requestId: requestId, requestHash: requestHash,
  };
  writeTableRecordUnlocked_('expenses', record);
  writeCompletedRequestUnlocked_(request, record);
  return record;
}

function normalizedPendingExpensePayload_(request) {
  let stored;
  try { stored = JSON.parse(String(request.payloadJson || '')); }
  catch (error) { throw new Error('保留中の支出内容を読み取れません。台帳を管理者が確認してください。'); }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('保留中の支出内容が正しくありません。台帳を管理者が確認してください。');
  const payload = {
    id: stored.id ? String(stored.id) : '', date: validateDate_(stored.date),
    memberId: String(stored.memberId || ''), sourceId: String(stored.sourceId || ''),
    categoryId: String(stored.categoryId || ''), amount: integerAmount_(stored.amount, '金額', false),
    memo: normalizeText_(stored.memo || '', 'メモ', 200), placeId: stored.placeId ? String(stored.placeId) : '',
    createdBy: String(stored.createdBy || '').toLowerCase(),
  };
  if (!payload.createdBy || requestFingerprint_('expense', payload) !== request.requestHash) {
    throw new Error('保留中の支出内容ハッシュが一致しません。台帳を管理者が確認してください。');
  }
  return payload;
}

function withIdempotentWrite_(type, requestId, operation, requestHash, callback, intent) {
  return withWriteLock_(function () {
    const requestsSheet = getFamilySpreadsheet_().getSheetByName(FAMILY_TABLES_.requests.name);
    if (!requestsSheet) throw new Error('Requestsシートがありません。管理者が初期設定を確認してください。');
    ensureRequestsSchemaUnlocked_(requestsSheet);

    const logged = findByField_('requests', 'requestId', requestId);
    if (logged) {
      if (logged.operation !== operation) throw new Error('保存要求IDが別の操作で使用されています。');
      if (logged.requestHash !== requestHash) throw new Error('同じ保存要求IDで異なる内容は保存できません。この要求IDの内容が保存済みの可能性があるため、台帳を確認してください。');
      if (logged.status === 'needsReview') throw needsReviewExpenseError_();
      if (logged.status === 'notApplied') throw new Error('この保存要求は未適用として終了しました。内容を確認して新しい要求IDで保存してください。');
      if (logged.status !== 'pending') {
        if (!logged.resultJson) throw new Error('保存要求の結果を確認できません。台帳を管理者が確認してください。');
        return JSON.parse(logged.resultJson);
      }
      if (operation === 'expense') {
        const recovered = recoverPendingExpenseRequestUnlocked_(logged);
        const updatedRequest = findByField_('requests', 'requestId', requestId);
        if (updatedRequest && updatedRequest.status === 'needsReview') throw needsReviewExpenseError_();
        if (updatedRequest && updatedRequest.status === 'notApplied') throw new Error('この保存要求は未適用として終了しました。内容を確認して新しい要求IDで保存してください。');
        return recovered;
      }
      return resumePendingRequestUnlocked_(type, requestId, operation, requestHash, callback, logged);
    }

    const otherType = type === 'expenses' ? 'wallet' : 'expenses';
    if (findByField_(otherType, 'requestId', requestId)) throw new Error('保存要求IDが別の操作で使用されています。');
    const recovered = findByField_(type, 'requestId', requestId);
    if (recovered) {
      if (recovered.requestHash !== requestHash) throw new Error('同じ保存要求IDで異なる内容は保存できません。この要求IDの内容が保存済みの可能性があるため、台帳を確認してください。');
      writeCompletedRequestUnlocked_({
        requestId: requestId, operation: operation, requestHash: requestHash, createdAt: new Date().toISOString(),
      }, recovered);
      return recovered;
    }

    const targetRecordId = String(intent && intent.targetRecordId || '');
    let previousStateHash = '';
    if (type === 'expenses' && targetRecordId) {
      const blocker = findExpenseOperationBlocker_(targetRecordId);
      if (blocker && blocker.status === 'needsReview') throw needsReviewExpenseError_();
      const pending = blocker && blocker.status === 'pending' ? blocker : null;
      if (pending) {
        recoverPendingExpenseRequestUnlocked_(pending);
        const recoveredStatus = findByField_('requests', 'requestId', pending.requestId);
        if (recoveredStatus && recoveredStatus.status === 'needsReview') throw needsReviewExpenseError_();
        if (!recoveredStatus || recoveredStatus.status !== 'notApplied') {
          throw new Error('前回の支出更新を復旧しました。今回の内容を確認し、もう一度保存してください。');
        }
      }
      const current = findById_('expenses', targetRecordId);
      if (!current) throw new Error('更新対象の支出が見つかりません。');
      previousStateHash = expenseRecordStateHash_(current);
    }

    const now = new Date().toISOString();
    const pendingRequest = {
      requestId: requestId, operation: operation, recordId: '', requestHash: requestHash, resultJson: '',
      createdAt: now, status: 'pending', targetRecordId: targetRecordId,
      previousStateHash: previousStateHash, updatedAt: now,
      payloadJson: String(intent && intent.payloadJson || ''),
    };
    writeTableRecordUnlocked_('requests', pendingRequest, 'requestId');
    const result = callback();
    if (result.requestHash !== requestHash) throw new Error('保存要求の内容を確認できません。もう一度お試しください。');
    writeCompletedRequestUnlocked_(pendingRequest, result);
    return result;
  });
}

function resumePendingRequestUnlocked_(type, requestId, operation, requestHash, callback, logged) {
  const targetRecordId = String(logged.targetRecordId || '');
  if (targetRecordId) {
    const current = findById_('expenses', targetRecordId);
    if (!current) throw new Error('保留中の支出更新先が見つかりません。台帳を管理者が確認してください。');
    if (current.requestId === requestId && current.requestHash === requestHash) {
      writeCompletedRequestUnlocked_(logged, current);
      return current;
    }
    if (!logged.previousStateHash || expenseRecordStateHash_(current) !== logged.previousStateHash) {
      throw new Error('保留中の支出更新と台帳の内容が一致しません。台帳を管理者が確認してください。');
    }
  } else {
    const recovered = findByField_(type, 'requestId', requestId);
    if (recovered) {
      if (recovered.requestHash !== requestHash) throw new Error('同じ保存要求IDで異なる内容は保存できません。この要求IDの内容が保存済みの可能性があるため、台帳を確認してください。');
      writeCompletedRequestUnlocked_(logged, recovered);
      return recovered;
    }
  }

  const otherType = type === 'expenses' ? 'wallet' : 'expenses';
  if (findByField_(otherType, 'requestId', requestId)) throw new Error('保存要求IDが別の操作で使用されています。');
  const result = callback();
  if (result.requestHash !== requestHash) throw new Error('保存要求の内容を確認できません。もう一度お試しください。');
  writeCompletedRequestUnlocked_(logged, result);
  return result;
}

function writeCompletedRequestUnlocked_(request, result) {
  const now = new Date().toISOString();
  writeTableRecordUnlocked_('requests', {
    requestId: request.requestId, operation: request.operation, recordId: result.id,
    requestHash: request.requestHash, resultJson: JSON.stringify(result), createdAt: request.createdAt || now,
    status: 'complete', targetRecordId: request.targetRecordId || '',
    previousStateHash: request.previousStateHash || '', updatedAt: now,
    payloadJson: request.payloadJson || '',
  }, 'requestId');
}

function writeExpenseRequestTerminalStatusUnlocked_(request, status) {
  writeTableRecordUnlocked_('requests', {
    requestId: request.requestId, operation: request.operation, recordId: request.recordId || '',
    requestHash: request.requestHash, resultJson: request.resultJson || '', createdAt: request.createdAt || new Date().toISOString(),
    status: status, targetRecordId: request.targetRecordId || '', previousStateHash: request.previousStateHash || '',
    updatedAt: new Date().toISOString(), payloadJson: request.payloadJson || '',
  }, 'requestId');
}

function findExpenseOperationBlocker_(expenseId) {
  return readTable_('requests').find(function (request) {
    return ['pending', 'needsReview'].indexOf(String(request.status || '')) >= 0 &&
      String(request.operation || '') === 'expense' && String(request.targetRecordId || '') === String(expenseId);
  }) || null;
}

function needsReviewExpenseError_() {
  return new Error('この支出には確認が必要な旧保存要求があります。台帳を管理者が確認するまで、この支出の更新・削除はできません。');
}

function expenseRecordStateHash_(record) {
  return requestFingerprint_('expenseRecordState', {
    id: String(record.id || ''), date: String(record.date || ''), memberId: String(record.memberId || ''),
    sourceId: String(record.sourceId || ''), categoryId: String(record.categoryId || ''), amount: Number(record.amount || 0),
    memo: String(record.memo || ''), placeId: String(record.placeId || ''), createdBy: String(record.createdBy || ''),
    createdAt: String(record.createdAt || ''), updatedBy: String(record.updatedBy || ''), updatedAt: String(record.updatedAt || ''),
    requestId: String(record.requestId || ''), requestHash: String(record.requestHash || ''),
  });
}

function findByField_(type, field, value) {
  return readTable_(type).find(function (row) { return String(row[field]) === String(value); }) || null;
}

function deleteTableRecord_(type, id) {
  return withWriteLock_(function () { deleteTableRecordUnlocked_(type, id); });
}

function deleteTableRecordUnlocked_(type, id) {
  const table = FAMILY_TABLES_[type];
  const sheet = getFamilySpreadsheet_().getSheetByName(table.name);
  if (!sheet || sheet.getLastRow() < 2) return;
  const keyColumn = table.headers.indexOf('id') + 1;
  const ids = sheet.getRange(2, keyColumn, sheet.getLastRow() - 1, 1).getValues();
  for (let index = ids.length - 1; index >= 0; index--) {
    if (String(ids[index][0]) === String(id)) { sheet.deleteRow(index + 2); return; }
  }
}

function findById_(type, id) {
  if (!id) return null;
  return readTable_(type).find(function (row) { return String(row.id) === String(id); }) || null;
}

function withWriteLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('別の保存処理を実行中です。少し待ってからもう一度お試しください。');
  try { return callback(); }
  finally { lock.releaseLock(); }
}

function masterConfig_(type) {
  if (['members', 'sources', 'categories', 'places'].indexOf(type) < 0) throw new Error('マスタの種類が正しくありません。');
  return FAMILY_TABLES_[type];
}

function requireActiveReference_(records, id, label) {
  const record = records.find(function (row) { return String(row.id) === String(id); });
  if (!record || !boolValue_(record.active)) throw new Error(label + 'を選び直してください。');
  return record;
}

function validateExpenseInput_(input) {
  if (!input || typeof input !== 'object') throw new Error('支出内容を読み取れません。');
  return {
    id: input.id ? String(input.id) : '',
    date: validateDate_(input.date),
    memberId: String(input.memberId || ''),
    sourceId: String(input.sourceId || ''),
    categoryId: String(input.categoryId || ''),
    amount: integerAmount_(input.amount, '金額', false),
    memo: normalizeText_(input.memo || '', 'メモ', 200),
    placeId: input.placeId ? String(input.placeId) : '',
  };
}

function normalizeSettingRecord_(table, input) {
  if (!input || typeof input !== 'object') throw new Error('設定内容を読み取れません。');
  if (table === 'fixedCosts') {
    const name = normalizeText_(input.name, '固定費名', 80);
    const amount = integerAmount_(input.amount, '金額', false);
    const day = Number(input.day);
    if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error('支払日は1〜31で入力してください。');
    const frequency = String(input.frequency || 'monthly');
    if (['monthly', 'bimonthly', 'yearly'].indexOf(frequency) < 0) throw new Error('頻度を選び直してください。');
    requireActiveReference_(readTable_('categories'), input.categoryId, 'カテゴリ');
    if (input.sourceId) requireActiveReference_(readTable_('sources'), input.sourceId, '支払元');
    if (input.placeId) requireActiveReference_(readTable_('places'), input.placeId, '場所');
    return { id: input.id ? String(input.id) : '', name: name, amount: amount, day: day, frequency: frequency,
      categoryId: String(input.categoryId), sourceId: String(input.sourceId || ''), placeId: String(input.placeId || ''),
      note: normalizeText_(input.note || '', '備考', 200), active: true };
  }
  const conditionType = String(input.conditionType || '');
  if (['subject', 'keyword'].indexOf(conditionType) < 0) throw new Error('条件の種類を選び直してください。');
  if (input.sourceId) requireActiveReference_(readTable_('sources'), input.sourceId, '支払元');
  if (input.categoryId) requireActiveReference_(readTable_('categories'), input.categoryId, 'カテゴリ');
  if (input.placeId) requireActiveReference_(readTable_('places'), input.placeId, '場所');
  return { id: input.id ? String(input.id) : '', conditionType: conditionType,
    condition: normalizeText_(input.condition, '条件', 160), sourceId: String(input.sourceId || ''),
    categoryId: String(input.categoryId || ''), placeId: String(input.placeId || ''), active: true };
}

function integerAmount_(value, label, allowZero) {
  const amount = typeof value === 'number' ? value : Number(String(value || '').replace(/,/g, ''));
  if (!Number.isSafeInteger(amount) || amount < (allowZero ? 0 : 1)) throw new Error(label + 'は' + (allowZero ? '0円以上' : '1円以上') + 'の整数で入力してください。');
  return amount;
}

function validateDate_(value) {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isDateValue_(date)) throw new Error('日付を正しく入力してください。');
  return date;
}

function isDateValue_(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return true;
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return false;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

function normalizeLegacyDate_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy-MM-dd');
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function localDate_(date) { return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd'); }

function normalizeText_(value, label, maxLength) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (text.length > maxLength) throw new Error(label + 'は' + maxLength + '文字以内で入力してください。');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) throw new Error(label + 'に使用できない文字があります。');
  if (label !== 'メモ' && label !== '備考' && !text) throw new Error(label + 'を入力してください。');
  return text;
}

function boolValue_(value) { return value === true || String(value).toLowerCase() === 'true'; }

function publicUser_(user) {
  return { email: String(user.email || '').toLowerCase(), name: String(user.name || ''), role: String(user.role || 'member'),
    defaultMemberId: String(user.defaultMemberId || ''), active: boolValue_(user.active) };
}

function addWalletBalances_(sources, walletEntries, expenses) {
  const balances = calculateWalletBalances_(sources, walletEntries, expenses);
  return sources.map(function (source) {
    return Object.assign({}, source, { walletEnabled: boolValue_(source.walletEnabled), active: boolValue_(source.active), balance: balances[source.id] || 0 });
  });
}

function calculateWalletBalances_(sources, walletEntries, expenses) {
  const balances = {};
  sources.forEach(function (source) { if (boolValue_(source.walletEnabled)) balances[source.id] = 0; });
  walletEntries.forEach(function (entry) {
    if (!Object.prototype.hasOwnProperty.call(balances, entry.sourceId)) return;
    const amount = Number(entry.amount) || 0;
    if (entry.type === 'opening' || entry.type === 'topup') balances[entry.sourceId] += amount;
  });
  expenses.forEach(function (expense) {
    if (!Object.prototype.hasOwnProperty.call(balances, expense.sourceId)) return;
    balances[expense.sourceId] -= Number(expense.amount) || 0;
  });
  return balances;
}
