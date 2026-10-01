// LINE通知の固定設定です。
const GMAIL_IMPORT_SUCCESS_LABEL = '処理済み';
const LINE_SENT_LABEL_NAME = 'ProcessedForLINE';

const LINE_SCRIPT_PROPERTY_KEYS = Object.freeze({
  channelAccessToken: 'LINE_CHANNEL_ACCESS_TOKEN',
  groupId: 'LINE_GROUP_ID',
  gmailLabelsJson: 'LINE_GMAIL_LABELS_JSON'
});

const LINE_GMAIL_LABEL_KEYS = Object.freeze({
  rakutenSelf: 'rakutenSelf',
  rakutenAlertSelf: 'rakutenAlertSelf',
  rakutenFamily: 'rakutenFamily',
  rakutenAlertFamily: 'rakutenAlertFamily',
  rakutenPay: 'rakutenPay',
  amazonCard: 'amazonCard'
});

function getRequiredLineScriptProperty_(properties, propertyName) {
  const value = properties.getProperty(propertyName);
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`必須のスクリプトプロパティ「${propertyName}」が未設定です`);
  }
  return value.trim();
}

function getLineAccessToken() {
  const properties = PropertiesService.getScriptProperties();
  return getRequiredLineScriptProperty_(properties, LINE_SCRIPT_PROPERTY_KEYS.channelAccessToken);
}

function getLineGmailLabels_(properties) {
  const serialized = getRequiredLineScriptProperty_(
    properties,
    LINE_SCRIPT_PROPERTY_KEYS.gmailLabelsJson
  );
  let labels;
  try {
    labels = JSON.parse(serialized);
  } catch (error) {
    throw new Error('LINE_GMAIL_LABELS_JSON はJSONオブジェクトで設定してください');
  }
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) {
    throw new Error('LINE_GMAIL_LABELS_JSON はJSONオブジェクトで設定してください');
  }

  const normalizedLabels = {};
  Object.keys(LINE_GMAIL_LABEL_KEYS).forEach(key => {
    const propertyKey = LINE_GMAIL_LABEL_KEYS[key];
    const value = labels[propertyKey];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`LINE_GMAIL_LABELS_JSON に「${propertyKey}」を設定してください`);
    }
    normalizedLabels[key] = value.trim();
  });
  return normalizedLabels;
}

function getLineConfiguration() {
  const properties = PropertiesService.getScriptProperties();
  const getRequired = propertyName => getRequiredLineScriptProperty_(properties, propertyName);
  const gmailLabels = getLineGmailLabels_(properties);

  return {
    accessToken: getRequired(LINE_SCRIPT_PROPERTY_KEYS.channelAccessToken),
    groupId: getRequired(LINE_SCRIPT_PROPERTY_KEYS.groupId),
    importSuccessLabel: GMAIL_IMPORT_SUCCESS_LABEL,
    sentLabel: LINE_SENT_LABEL_NAME,
    notificationTargets: [
      {
        gmailLabel: gmailLabels.rakutenSelf,
        subjectIncludes: 'カード利用のお知らせ(本人ご利用分)',
        subjectExcludes: '【速報版】'
      },
      {
        gmailLabel: gmailLabels.rakutenAlertSelf,
        subjectIncludes: '【速報版】カード利用のお知らせ(本人ご利用分)'
      },
      {
        gmailLabel: gmailLabels.rakutenFamily,
        subjectIncludes: 'カード利用のお知らせ(家族会員ご利用分)',
        subjectExcludes: '【速報版】'
      },
      {
        gmailLabel: gmailLabels.rakutenAlertFamily,
        subjectIncludes: '【速報版】カード利用のお知らせ(家族会員ご利用分)'
      },
      {
        gmailLabel: gmailLabels.rakutenPay,
        subjectIncludes: '楽天ペイお支払い完了のお知らせ【楽天ペイアプリ】'
      },
      {
        gmailLabel: gmailLabels.amazonCard,
        subjectIncludes: 'ご利用のお知らせ【三井住友カード】'
      }
    ]
  };
}
