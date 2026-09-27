# 家族用帳簿の初期設定とバックアップ移行

## 管理者による初期設定

1. 家族用のGoogleスプレッドシートを新規作成し、管理者をオーナーにします。アプリ利用者へシートそのものを共有しません。
2. `Users`シートを作り、1行目に次の見出し、2行目に初回管理者を登録します。

   | email | name | role | defaultMemberId | active | updatedBy | updatedAt |
   | --- | --- | --- | --- | --- | --- | --- |
   | 管理者のGoogleメール | 管理者 | admin | member-self | TRUE |  |  |

3. Apps Scriptの **プロジェクトの設定 → スクリプト プロパティ** に`FAMILY_SPREADSHEET_ID`、必要なら`GOOGLE_OAUTH_CLIENT_ID`、`GOOGLE_OAUTH_CLIENT_SECRET`を登録します。IDを上書きする場合、クライアントIDとシークレットは同じOAuthクライアントの組み合わせにします。シークレットはスクリプトプロパティだけに置き、ソースコード、HTML、ログ、シートに記録しません。
4. Google Cloudのウェブアプリ用OAuthクライアントで、次のURIを「承認済みのリダイレクトURI」に完全一致で登録します。

   ```text
   https://script.google.com/macros/d/1zhqVIRy5YKrDURd77Tl5I4Za4f-1kvGqyJbvwnesW1HLFt8j7InXa3sQ/usercallback
   ```

   ログイン要求は`openid email`だけを使用します。認証コードはGASサーバー側で交換し、IDトークンの署名・宛先・発行元・期限・確認済みメール・nonceを検証してから`Users`シートを照合します。アクセストークンと更新トークンは保存しません。
5. `appsscript.json`にはProperties Serviceの書き込み・削除に必要な`https://www.googleapis.com/auth/script.storage`と、再承認確認で実行アカウントのメールが空でないことを調べる`https://www.googleapis.com/auth/userinfo.email`を含めます。[Google公式Codelab](https://codelabs.developers.google.com/codelabs/gmail-add-ons)もProperties Serviceの読書きに`script.storage`を指定しています。`userinfo.email`はApps Script上の診断用で、ログイン利用者の認証・`Users`照合には使いません。どちらもOAuthログイン要求の`openid email`とは別のApps Scriptプロジェクト権限です。全宣言スコープの確認には`ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL)`を使います。[公式スコープ説明](https://developers.google.com/apps-script/concepts/scopes)を参照してください。

   最新の`Code.gs`と`appsscript.json`を同期した後、`authorizeFamilyLedgerServices_`でサービス権限を確認します。エディタで末尾`_`付き関数を実行できない場合は、`Code.gs`を編集せず、[家族用GAS家計簿のREADME](../gas/webapp-pilot/README.md)の手順に沿って別ファイル`AuthorizeOnce.gs`を一時作成し、`authorizeFamilyLedgerServicesEditorRunner`を所有者として実行します。全スコープの承認を許可した後、このファイルを削除します。一時関数を削除した後、エディタの実行一覧から消えるのは想定どおりです。ウェブアプリ利用者から呼べる公開RPCにしないため常設せず、専用デプロイスクリプトも`.gs`/`.js`全ファイルを再帰確認してrunnerが残っていれば拒否します。

   確認関数は実行アカウントのメールが空でないことを検査しますが、その値を保存・ログ出力せず、アプリ認証にも使用しません。一意な一時プロパティを保存・読戻し・削除し、スプレッドシート読取り、公開鍵接続、State Token作成も確認します。台帳と設定値は変更しません。実行ログでは`doGet:`と`authCallback:`の固定段階メッセージを確認します。認証コード、token、state、nonce、セッション、メール、シークレット、生例外は記録しません。

   実認証を確認するまでは既存のデプロイアクセスと`appsscript.json`の`MYSELF`制限を維持し、家族へ公開しません。

   `userinfo.email`追加は、[Google公式のApps Script OAuth2 issue #107](https://github.com/googleworkspace/apps-script-oauth2/issues/107#issuecomment-375887160)に似た症状の解消報告があるため検証する仮説です。今回の原因は確定しておらず、実OAuthの成功も未確認です。
6. 管理者アカウントでGoogle認証画面からログインして「設定 → 初期化する」を実行します。各表は未作成なら作成され、既存の値があれば削除しません。標準の利用者は「自分」「パートナー」「共通／家族」、支払元は「パートナー現金」（財布有効）と「家族カード」（財布無効）です。
7. 管理者はユーザー管理から家族のGoogleアカウントを必要な人数分追加・停止・権限変更できます。ユーザー数に固定の制限は設けていません。ユーザー管理を行えるのは管理者だけです。一般ユーザーの既定利用者は、その人が通常記録する利用者を選びます。共有支出は入力時に「共通／家族」を選びます。

家族へ公開する前に、非公開の実デプロイで上記リダイレクトURI、認証コード交換、state/nonce検証、許可・未登録ユーザーの結果を確認します。これらを確認するまでは`MYSELF`アクセスを維持し、デプロイやアクセス範囲を変更しないでください。確認後に公開する場合も、ウェブアプリは管理者として実行し、Googleアカウントのログインを必須にします。シートそのものは家族へ共有しません。

## 日次Google Sheetsバックアップからの移行

移行元はLambdaが出力した日次バックアップだけにします。移行元シートやLambdaのDynamoDBデータは編集・削除しません。まずバックアップを複製し、複製側で抽出と件数照合を行います。

バックアップの列は次の順序です。K列の見出しは`visibility`です。

| 列 | 見出し | 新しい家族用シートの対応 |
| --- | --- | --- |
| A | `id` | `Expenses.id` |
| B | `date` | `Expenses.date` |
| C | `payer` | 支払元マスタ名を照合して`Expenses.sourceId`へ |
| D | `category` | カテゴリマスタ名を照合して`Expenses.categoryId`へ |
| E | `amount` | `Expenses.amount` |
| F | `memo` | `Expenses.memo` |
| G | `place` | 場所マスタ名を照合して`Expenses.placeId`へ。空欄は空欄 |
| H | `createdBy` | `Expenses.createdBy`へ由来情報として保存 |
| I | `createdAt` | `Expenses.createdAt` |
| J | `updatedAt` | `Expenses.updatedAt` |
| K | `visibility` | 抽出条件にだけ使い、新シートへはコピーしない |

### 抽出条件

- K列`visibility`が`public`の行だけを対象にします。既存バックアップと同じく小文字の`public`を使います。
- K列が空欄の行も対象にします。空欄はセル値が空文字、`null`、`undefined`の場合だけです。数値の`0`、`false`、空白文字やその他の値は空欄とみなさず除外します。
- `summary`、`private`、その他空欄でも`public`でもない値は除外します。
- カテゴリが`収入`の行は除外します。さらに移行前にLambdaのカテゴリマスタを確認し、`isExpense`が`false`のカテゴリをすべて非支出カテゴリとして除外します（例: `現金チャージ`）。ほかの収入カテゴリも含め、非支出カテゴリの対象件数を確認してから進めます。
- ID、日付、カテゴリ、正の整数金額が欠ける不正行は除外し、移行前に件数を記録して理由を調べます。

このプロジェクトのローカル検証関数`transformLegacyBackupRows_`は、K列が`public`または空の行だけを抽出し、`summary`・`private`とカテゴリ`収入`を除外します。追加の`isExpense=false`カテゴリ名を渡すと、それらも非支出として除外します。ブラウザーから呼べるサーバー関数にはしていません。

### 新シートへコピーする前の確認

1. まず家族用スプレッドシートを複製またはエクスポートして、移行前の状態を保管します。
2. バックアップ複製で`visibility`ごとの行数を数え、`public`、空欄、`summary`、`private`、その他の各件数を記録します。さらに収入カテゴリと不正行の件数を確認します。
3. 対象にした各旧`payer`が新しい`PaymentSources`にあることを確認します。ない支払元は管理者が追加してから対応づけます。名前が似ているだけの支払元へ自動で結び付けず、管理者が決めます。
4. 旧カテゴリが新しい`Categories`にあり、場所が一致する場合は`Places`にあることを確認します。未登録のカテゴリ・場所は管理者が追加します。
5. 各抽出行を新しい`Expenses`列順へ変換します。`memberId`はすべて`member-self`にします。旧`payer`は利用者ではなく支払元に対応させます。
6. `createdBy`は旧値を由来情報として残し、利用者の推定には使いません。`createdBy`がメールアドレス、`Webhook`、`schedule`などのどの値でも、移行した利用者は「自分」です。元の作成者をパートナー等へ割り当てないでください。
7. 新しい`Expenses`シートへ行を追加する前に、対象のID重複がないことを確認します。移行を繰り返す場合は、ID重複を照合して既存行を二重追加しないでください。
8. 移行後に対象件数、除外件数、対象金額合計、移行後の金額合計、IDの重複を照合します。支払元・カテゴリ・場所のID対応件数も確認します。差があれば家族ユーザーへ共有する前に修正します。

移行行のフィールド対応は次のとおりです。

| `Expenses`列 | 設定値 |
| --- | --- |
| `id` | 旧`id`を維持 |
| `date` | 旧`date` |
| `memberId` | `member-self`（全行固定） |
| `sourceId` | 旧`payer`に対応する支払元ID |
| `categoryId` | 旧`category`に対応するカテゴリID |
| `amount` | 旧`amount` |
| `memo` | 旧`memo` |
| `placeId` | 旧`place`に対応する場所ID、または空欄 |
| `createdBy` | 旧`createdBy`を由来情報として保持 |
| `createdAt` | 旧`createdAt` |
| `updatedBy` | 空欄（旧バックアップに利用者更新情報はない） |
| `updatedAt` | 旧`updatedAt` |
| `requestId` | 空欄（移行行にアプリの再送防止要求IDはない） |
| `requestHash` | 空欄（移行行にアプリの要求内容ハッシュはない） |

## 保存データの範囲

家族用帳簿には家族支出だけを保存します。収入、個人用の支出、個人帳簿との同期、Gmail読取、メール自動分類、固定費の自動起票、支出の個別公開範囲はありません。固定費・予算・メール分類ルールは設定レコードとして保存します。

一般的な外部共有シートのテンプレートや他サービスからの汎用インポートは今回の対象外です。必要になった場合に、移行時の安全性・列対応・利用者割当を決めてから後日検討する低優先度の拡張項目です。
