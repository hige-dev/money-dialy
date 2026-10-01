// ========================================
// Webhookスクリプト - ユーザーID/グループID取得用
// ========================================
// このスクリプトは、友だちがBotにメッセージを送った時に
// ユーザーIDまたはグループIDを取得するために使用します。
// ========================================

// GETリクエスト用（念のため）
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({'status': 'ok'}))
    .setMimeType(ContentService.MimeType.JSON);
}

// Webhook受信用の関数
function doPost(e) {
  try {
    const json = JSON.parse(e.postData.contents);

    if (json.events && json.events.length > 0) {
      const event = json.events[0];
      let responseText = '';

      // 個人トークの場合
      if (event.source.type === 'user') {
        const userId = event.source.userId;
        responseText = 'あなたのユーザーIDは:\n' + userId;
      }
      // グループトークの場合
      else if (event.source.type === 'group') {
        const groupId = event.source.groupId;
        responseText = 'このグループのIDは:\n' + groupId;
      }
      // 複数人トークの場合
      else if (event.source.type === 'room') {
        const roomId = event.source.roomId;
        responseText = 'このルームのIDは:\n' + roomId;
      }

      // グループの場合は、返信ではなくプッシュメッセージで送信
      if (event.source.type === 'group') {
        const groupId = event.source.groupId;
        sendPushMessage(groupId, responseText);
      } else {
        // 個人トークの場合は返信
        const replyToken = event.replyToken;
        const replyMessage = {
          'replyToken': replyToken,
          'messages': [{
            'type': 'text',
            'text': responseText
          }]
        };

        const options = {
          'method': 'post',
          'headers': {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + getLineAccessToken()
          },
          'payload': JSON.stringify(replyMessage)
        };

        UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', options);
      }
    }
  } catch (error) {
    // リクエスト内容や認証情報を含む可能性があるため、詳細はログに残しません。
    Logger.log('Webhookの処理に失敗しました');
  }

  // 必ず200 OKを返す
  return ContentService.createTextOutput(JSON.stringify({'status': 'ok'}))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * プッシュメッセージを送信（グループ用）
 */
function sendPushMessage(to, messageText) {
  const url = 'https://api.line.me/v2/bot/message/push';

  const payload = {
    'to': to,
    'messages': [{
      'type': 'text',
      'text': messageText
    }]
  };

  const options = {
    'method': 'post',
    'headers': {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + getLineAccessToken()
    },
    'payload': JSON.stringify(payload)
  };

  try {
    UrlFetchApp.fetch(url, options);
    Logger.log('プッシュメッセージ送信成功');
  } catch (error) {
    Logger.log('プッシュメッセージの送信に失敗しました');
  }
}
