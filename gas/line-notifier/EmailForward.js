// ========================================
// メール転送スクリプト
// ========================================
// Gmailから特定のメールを検索し、LINEに転送します
// ========================================

// ========================================
// メール転送スクリプト
// ========================================

// GmailImportが対応し、保存成功後に「処理済み」を付けるメールだけを通知する。
// Gmailラベルはスレッド単位なので、件名と元ラベルもメッセージごとに確認する。
const LINE_SENT_MESSAGE_IDS_PROPERTY = 'LINE_SENT_MESSAGE_IDS_V1';
const LINE_LEGACY_CURSOR_FLOOR_PROPERTY = 'LINE_LEGACY_CURSOR_FLOOR_MS_V1';
const MAX_LINE_SENT_MESSAGE_IDS = 250;
const MAX_LINE_SENT_MESSAGE_IDS_LENGTH = 7000;

/**
 * 送信済みメールIDをScript Propertiesから読み込む。
 * 1つの値に件数と文字数の上限を設け、古いIDから掃除する。
 */
function loadSentLineMessageIds(scriptProperties) {
  const serialized = scriptProperties.getProperty(LINE_SENT_MESSAGE_IDS_PROPERTY);
  if (!serialized) {
    return new Set();
  }

  try {
    const messageIds = JSON.parse(serialized);
    if (!Array.isArray(messageIds)) {
      return new Set();
    }
    const retainedIds = Array.from(new Set(messageIds.filter(messageId => typeof messageId === 'string')));
    while (retainedIds.length > MAX_LINE_SENT_MESSAGE_IDS ||
      JSON.stringify(retainedIds).length > MAX_LINE_SENT_MESSAGE_IDS_LENGTH) {
      retainedIds.shift();
    }
    const normalizedSerialized = JSON.stringify(retainedIds);
    if (normalizedSerialized !== serialized) {
      try {
        scriptProperties.setProperty(LINE_SENT_MESSAGE_IDS_PROPERTY, normalizedSerialized);
      } catch (error) {
        Logger.log('送信済みメールIDの古い記録を掃除できませんでした');
      }
    }
    return new Set(retainedIds);
  } catch (error) {
    Logger.log('送信済みメールIDを読み込めませんでした。重複通知の可能性があります');
    return new Set();
  }
}

/**
 * 送信済みメールIDを永続化する。1値あたり7,000文字までに抑える。
 */
function recordSentLineMessageId(scriptProperties, sentMessageIds, messageId) {
  if (!messageId) {
    return false;
  }
  if (sentMessageIds.has(messageId)) {
    return true;
  }

  const retainedIds = Array.from(sentMessageIds);
  retainedIds.push(messageId);
  while (retainedIds.length > MAX_LINE_SENT_MESSAGE_IDS ||
    JSON.stringify(retainedIds).length > MAX_LINE_SENT_MESSAGE_IDS_LENGTH) {
    retainedIds.shift();
  }
  if (!retainedIds.includes(messageId)) {
    return false;
  }

  try {
    scriptProperties.setProperty(LINE_SENT_MESSAGE_IDS_PROPERTY, JSON.stringify(retainedIds));
  } catch (error) {
    Logger.log('送信済みメールIDを保存できませんでした。次回の再試行で重複する可能性があります');
    return false;
  }

  sentMessageIds.clear();
  retainedIds.forEach(retainedId => sentMessageIds.add(retainedId));
  return true;
}

/** カーソル境界時刻の既読通知対象メールを送信済み台帳へ登録します。 */
function initializeLegacySentLineMessageIds(scriptProperties, sentMessageIds, messages,
    legacyFloorMs, lineConfiguration) {
  const storedIds = scriptProperties.getProperty(LINE_SENT_MESSAGE_IDS_PROPERTY);
  if (storedIds) {
    return true;
  }

  const legacyMessageIds = new Set();
  messages.forEach(item => {
    if (item.timeMs !== legacyFloorMs || item.message.isUnread()) {
      return;
    }
    const subject = item.message.getSubject() || '';
    if (isLineNotificationTarget(subject, item.threadLabelNames, true, lineConfiguration)) {
      legacyMessageIds.add(item.message.getId());
    }
  });

  const ids = Array.from(legacyMessageIds);
  const serialized = JSON.stringify(ids);
  if (ids.length > MAX_LINE_SENT_MESSAGE_IDS || serialized.length > MAX_LINE_SENT_MESSAGE_IDS_LENGTH) {
    Logger.log('送信済みメール記録が保存上限を超えています。処理を続けられません');
    return false;
  }

  try {
    // 空配列を記録し、同じカーソル時刻の未処理メールと区別する。
    scriptProperties.setProperty(LINE_SENT_MESSAGE_IDS_PROPERTY, serialized);
  } catch (error) {
    Logger.log('送信済みメール記録を保存できませんでした。次回実行で再試行します');
    return false;
  }

  sentMessageIds.clear();
  ids.forEach(messageId => sentMessageIds.add(messageId));
  Logger.log(`送信済みメール記録を初期化しました（${ids.length}件）`);
  return true;
}

/**
 * 通知対象のメールかを確認する。
 * Gmailラベルだけではスレッド内の個々のメールを区別できないため、
 * 件名と元ラベルをメッセージごとに確認する。
 */
function isLineNotificationTarget(subject, threadLabelNames, requireImportSuccess, lineConfiguration) {
  if (!Array.isArray(threadLabelNames)) {
    return false;
  }

  const configuration = lineConfiguration || getLineConfiguration();
  const labelNames = new Set(threadLabelNames);
  if (requireImportSuccess && !labelNames.has(configuration.importSuccessLabel)) {
    return false;
  }

  const normalizedSubject = (subject || '').trim();
  return configuration.notificationTargets.some(target =>
    normalizedSubject.includes(target.subjectIncludes) &&
    (!target.subjectExcludes || !normalizedSubject.includes(target.subjectExcludes)) &&
    labelNames.has(target.gmailLabel)
  );
}

function isEligibleForLineNotification(subject, isUnread, threadLabelNames, lineConfiguration) {
  return !isUnread && isLineNotificationTarget(subject, threadLabelNames, true, lineConfiguration);
}

/**
 * メール転送のメイン関数
 * トリガーから定期的に実行されます
 */
function forwardEmailToLine() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log('別のLINE通知処理が実行中のため、今回は見送ります');
    return;
  }

  try {
    forwardEmailToLineWithLock();
  } finally {
    lock.releaseLock();
  }
}

/** ScriptLockを保持している間だけ実行する処理 */
function forwardEmailToLineWithLock() {
  const lineConfiguration = getLineConfiguration();
  const scriptProperties = PropertiesService.getScriptProperties();
  const PROPERTY_KEY = 'LAST_PROCESSED_TIME_MS';
  const existingSentMessageIds = scriptProperties.getProperty(LINE_SENT_MESSAGE_IDS_PROPERTY);
  const sentMessageIds = loadSentLineMessageIds(scriptProperties);

  const storedCursorMs = parseInt(scriptProperties.getProperty(PROPERTY_KEY) || '0', 10);
  const needsLegacySentIdBootstrap = storedCursorMs > 0 && !existingSentMessageIds;
  const storedLegacyFloor = scriptProperties.getProperty(LINE_LEGACY_CURSOR_FLOOR_PROPERTY);
  let legacyFloorMs = storedLegacyFloor ? Number(storedLegacyFloor) : null;
  if (needsLegacySentIdBootstrap) {
    if (!Number.isFinite(legacyFloorMs)) {
      legacyFloorMs = storedCursorMs;
      try {
        // 基準時刻の保存だけでは送信済み記録の確定にならない。記録前に停止した場合も次回再走査する。
        scriptProperties.setProperty(LINE_LEGACY_CURSOR_FLOOR_PROPERTY, legacyFloorMs.toString());
      } catch (error) {
        Logger.log('処理カーソルの基準時刻を保存できませんでした。次回実行で再試行します');
        return;
      }
    }
  }
  let lastProcessedTimeMs = storedCursorMs;

  if (lastProcessedTimeMs === 0) {
    lastProcessedTimeMs = new Date().getTime();
    scriptProperties.setProperty(PROPERTY_KEY, lastProcessedTimeMs.toString());
    Logger.log('初期化: 基準日時を現在時刻に設定しました。次回受信分から転送します。');
    return;
  }

  let label = GmailApp.getUserLabelByName(lineConfiguration.sentLabel);
  if (!label) {
    label = GmailApp.createLabel(lineConfiguration.sentLabel);
  }

  const sourceLabels = lineConfiguration.notificationTargets.map(target => target.gmailLabel);
  const pageSize = 100;

  // Gmailのラベルはスレッド単位なので、同じスレッドにある未取込メールも探す。
  // そのメールの日時よりカーソルが先なら、取り込み後に再試行できる位置まで戻す。
  const pendingQuery = `label:{${sourceLabels.join(' ')}} is:unread`;
  let pendingStart = 0;
  let pendingMessages = [];
  let earliestPendingTimeMs = null;
  let pendingCursorRewindMs = null;
  while (true) {
    const pendingThreads = GmailApp.search(pendingQuery, pendingStart, pageSize);
    if (pendingThreads.length === 0) {
      break;
    }

    pendingThreads.forEach(thread => {
      const threadLabelNames = thread.getLabels().map(threadLabel => threadLabel.getName());
      thread.getMessages().forEach(message => {
        const subject = message.getSubject() || '';
        const messageId = message.getId();
        if (!message.isUnread() || sentMessageIds.has(messageId) ||
          !isLineNotificationTarget(subject, threadLabelNames, false, lineConfiguration)) {
          return;
        }

        const timeMs = message.getDate().getTime();
        if (legacyFloorMs !== null && timeMs < legacyFloorMs) {
          return;
        }
        pendingMessages.push({
          message: message,
          thread: thread,
          threadLabelNames: threadLabelNames,
          timeMs: timeMs
        });
        if (earliestPendingTimeMs === null || timeMs < earliestPendingTimeMs) {
          earliestPendingTimeMs = timeMs;
        }
      });
    });

    pendingStart += pendingThreads.length;
    if (pendingThreads.length < pageSize) {
      break;
    }
  }

  if (earliestPendingTimeMs !== null && earliestPendingTimeMs <= lastProcessedTimeMs) {
    lastProcessedTimeMs = Math.max(0, earliestPendingTimeMs - 1);
    if (needsLegacySentIdBootstrap) {
      // 現在のカーソル値を更新する前に、メール検索の開始境界を保存する。
      pendingCursorRewindMs = lastProcessedTimeMs;
    } else {
      // 以降の検索や送信が中断しても、次回実行でこの未取込メールを拾えるよう先に保存する。
      scriptProperties.setProperty(PROPERTY_KEY, lastProcessedTimeMs.toString());
    }
  }

  // Gmailのafter条件は秒単位なので、カーソルが属する秒より1秒前から検索する。
  const lastProcessedTimeSec = Math.max(0, Math.floor(lastProcessedTimeMs / 1000) - 1);
  // 重複検索窓はこの時刻より後。境界時刻と、それより古い同スレッドのメールは通知しない。
  const searchWindowStartMs = lastProcessedTimeSec * 1000;
  const query = `label:{${sourceLabels.join(' ')}} label:${lineConfiguration.importSuccessLabel} is:read after:${lastProcessedTimeSec}`;

  // 「処理済み」はGmailImport成功の印。「ProcessedForLINE」は検索条件に
  // 含めず、同じスレッドに後から届いたメールも通知対象にできるようにする。
  let start = 0;
  const allMessagesById = new Map();
  while (true) {
    const threads = GmailApp.search(query, start, pageSize);
    if (threads.length === 0) {
      break;
    }

    threads.forEach(thread => {
      const threadLabelNames = thread.getLabels().map(threadLabel => threadLabel.getName());
      thread.getMessages().forEach(message => {
        const messageId = message.getId();
        if (allMessagesById.has(messageId)) {
          return;
        }
        allMessagesById.set(messageId, {
          message: message,
          thread: thread,
          threadLabelNames: threadLabelNames,
          timeMs: message.getDate().getTime()
        });
      });
    });

    start += threads.length;
    if (threads.length < pageSize) {
      break;
    }
  }

  // `is:read`検索に現れない未読メールも、カーソルを止める候補として加える。
  pendingMessages.forEach(item => {
    const messageId = item.message.getId();
    if (!allMessagesById.has(messageId)) {
      allMessagesById.set(messageId, item);
    }
  });
  const allMessages = Array.from(allMessagesById.values());

  if (needsLegacySentIdBootstrap) {
    if (!initializeLegacySentLineMessageIds(
      scriptProperties,
      sentMessageIds,
      allMessages,
      legacyFloorMs,
      lineConfiguration
    )) {
      return;
    }
    if (pendingCursorRewindMs !== null) {
      scriptProperties.setProperty(PROPERTY_KEY, pendingCursorRewindMs.toString());
    }
  }

  if (allMessages.length === 0) {
    Logger.log('新しいメールはありません');
    return;
  }

  // メッセージを日時の「古い順（昇順）」に並べて通知する。
  allMessages.sort((a, b) => a.timeMs - b.timeMs);

  let maxTimestampMs = lastProcessedTimeMs;
  let processedCount = 0;

  // 古い順に処理
  for (const item of allMessages) {
    const msgDateMs = item.timeMs;
    const message = item.message;
    const subject = message.getSubject() || '(件名なし)';
    const messageId = message.getId();
    const alreadySent = sentMessageIds.has(messageId);
    if (legacyFloorMs !== null && msgDateMs < legacyFloorMs) {
      continue;
    }

    if (message.isUnread() && !alreadySent &&
      isLineNotificationTarget(subject, item.threadLabelNames, false, lineConfiguration)) {
      // 未取込メールより後のメールを処理すると、カーソルが追い越してしまう。
      maxTimestampMs = Math.min(maxTimestampMs, msgDateMs - 1);
      Logger.log('GmailImport未完了のメールがあるため、このメール以降の通知を次回に回します');
      break;
    }

    // 保存済みIDは再送せず、ラベルだけは毎回照合して修復する。
    if (alreadySent) {
      item.thread.addLabel(label);
      if (msgDateMs > lastProcessedTimeMs) {
        if (msgDateMs > maxTimestampMs) {
          maxTimestampMs = msgDateMs;
        }
        processedCount++;
      }
      continue;
    }

    // 同時刻などカーソル以下の未送信メールはafter検索窓内だけ通知する。
    // スレッド検索で一緒に返った窓より古いメールは過去通知しない。
    if (msgDateMs <= lastProcessedTimeMs) {
      if (msgDateMs <= searchWindowStartMs) {
        continue;
      }
    }

    if (!isEligibleForLineNotification(
      subject,
      message.isUnread(),
      item.threadLabelNames,
      lineConfiguration
    )) {
      continue;
    }

    const from = message.getFrom() || '(送信者不明)';
    const date = Utilities.formatDate(message.getDate(), 'JST', 'yyyy/MM/dd HH:mm');
    const plainBody = message.getPlainBody() || '';
    const body = plainBody.substring(0, 500) || '(本文なし)';

    const notificationSucceeded = sendLinePushMessage(
      lineConfiguration.groupId,
      subject,
      from,
      date,
      body,
      lineConfiguration.accessToken
    );

    if (!notificationSucceeded) {
      // 失敗したメールより後を処理すると時間カーソルが先へ進むため、ここで止める。
      // 同一ミリ秒のメールを区別できるよう、失敗メール時刻より前をチェックポイントにする。
      maxTimestampMs = Math.min(maxTimestampMs, msgDateMs - 1);
      Logger.log('LINE送信失敗: このメール以降の処理を止め、次回トリガーで再試行します');
      break;
    }

    if (!recordSentLineMessageId(scriptProperties, sentMessageIds, messageId)) {
      Logger.log('送信済みメールIDを記録できないため、このメール以降の処理を止めます');
      break;
    }

    Logger.log(`転送完了: ${subject}`);

    // 処理済みラベルを付与
    item.thread.addLabel(label);

    // 最新のタイムスタンプを更新（古い順にソートされているため常に上書きで最新になる）
    if (msgDateMs > maxTimestampMs) {
      maxTimestampMs = msgDateMs;
    }
    processedCount++;
  }

  // 最新のタイムスタンプを保存
  if (maxTimestampMs !== storedCursorMs) {
    scriptProperties.setProperty(PROPERTY_KEY, maxTimestampMs.toString());
    Logger.log(`プロパティ更新: ${new Date(maxTimestampMs)} (${processedCount}件のメールを処理)`);
  }
}

/**
 * LINEにプッシュメッセージを送信
 * Flex Message形式で見やすく表示
 *
 * @param {string} userId - LINEユーザーID
 * @param {string} subject - メール件名
 * @param {string} from - 送信者
 * @param {string} date - 日時
 * @param {string} body - メール本文
 */
function sendLinePushMessage(userId, subject, from, date, body, accessToken) {
  const url = 'https://api.line.me/v2/bot/message/push';

  // 空文字列チェック（念のため）
  const safeSubject = subject || '(件名なし)';
  const safeFrom = from || '(送信者不明)';
  const safeBody = body || '(本文なし)';

  const payload = {
    'to': userId,
    'messages': [{
      'type': 'flex',
      'altText': `新着メール: ${safeSubject}`,
      'contents': {
        'type': 'bubble',
        'header': {
          'type': 'box',
          'layout': 'vertical',
          'contents': [{
            'type': 'text',
            'text': '📧 新着メール',
            'weight': 'bold',
            'color': '#FFFFFF',
            'size': 'md'
          }],
          'backgroundColor': '#1DB446'
        },
        'body': {
          'type': 'box',
          'layout': 'vertical',
          'contents': [
            {
              'type': 'text',
              'text': safeSubject,
              'weight': 'bold',
              'size': 'lg',
              'wrap': true,
              'color': '#1A1A1A'
            },
            {
              'type': 'box',
              'layout': 'vertical',
              'margin': 'lg',
              'spacing': 'sm',
              'contents': [
                // {
                //   'type': 'box',
                //   'layout': 'baseline',
                //   'spacing': 'sm',
                //   'contents': [
                //     {
                //       'type': 'text',
                //       'text': '差出人',
                //       'color': '#AAAAAA',
                //       'size': 'sm',
                //       'flex': 3
                //     },
                //     {
                //       'type': 'text',
                //       'text': safeFrom,
                //       'wrap': true,
                //       'color': '#666667',
                //       'size': 'sm',
                //       'flex': 6
                //     }
                //   ]
                // },
                {
                  'type': 'box',
                  'layout': 'baseline',
                  'spacing': 'sm',
                  'contents': [
                    {
                      'type': 'text',
                      'text': '日時',
                      'color': '#AAAAAA',
                      'size': 'sm',
                      'flex': 2
                    },
                    {
                      'type': 'text',
                      'text': date,
                      'wrap': true,
                      'color': '#666666',
                      'size': 'sm',
                      'flex': 5
                    }
                  ]
                }
              ]
            },
            {
              'type': 'separator',
              'margin': 'lg'
            },
            {
              'type': 'box',
              'layout': 'vertical',
              'margin': 'lg',
              'contents': [
                {
                  'type': 'text',
                  'text': '本文',
                  'color': '#AAAAAA',
                  'size': 'xs',
                  'margin': 'none'
                },
                {
                  'type': 'text',
                  'text': safeBody.substring(0, 800) + (safeBody.length > 800 ? '...' : ''),
                  'wrap': true,
                  'color': '#666666',
                  'size': 'sm',
                  'margin': 'md'
                }
              ]
            }
          ]
        }
      }
    }]
  };

  const options = {
    'method': 'post',
    'headers': {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + accessToken
    },
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    if (responseCode >= 200 && responseCode < 300) {
      return true;
    }

    // レスポンス本文には個人情報や秘密が含まれる可能性があるため記録しない。
    Logger.log(`LINE送信失敗: HTTP ${responseCode}`);
    return false;
  } catch (error) {
    // 例外メッセージにリクエスト情報が含まれる可能性があるため記録しない。
    Logger.log('LINE送信失敗: 通信エラー');
    return false;
  }
}

/**
 * 手動テスト用関数
 * スクリプトエディタから直接実行して動作確認できます
 */
function testForward() {
  forwardEmailToLine();
}
