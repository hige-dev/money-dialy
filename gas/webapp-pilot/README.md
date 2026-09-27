# Money Diary 家族用GAS家計簿

管理者が所有するGoogleスプレッドシートへ家族の支出を保存するGoogle Apps Scriptウェブアプリです。Google認証コードをGASサーバーで交換し、IDトークンの署名・発行元・宛先・有効期限・確認済みメール・nonceを検証してから、`Users`シートの有効アカウントと照合します。認証後はブラウザーごとのアプリセッションを発行し、台帳を扱う各操作でもセッションと`Users`シートの利用可否・権限を確認します。シートをアプリ利用者へ直接共有する必要はありません。

## 機能

- Googleのサーバー側OAuth認証コードフローと、IDトークンの署名・宛先・発行元・有効期限・確認済みメール・nonce検証
- ブラウザーごとのアプリセッションを再読み込み後も復元。明示的ログアウト、利用停止、またはウェブアプリのデプロイ世代更新まで有効
- 同じセッション・デプロイ世代の前回取得データをブラウザーに保存して起動時に表示。最新確認中と通信失敗中は閲覧専用で、取得日時と再確認ボタンを表示
- `Users`シートによる利用者許可、停止、一般ユーザー・管理者の権限管理
- 家族支出の入力、編集、削除、月別集計、利用者・支払元別フィルター、カレンダー表示
- 支出の利用者と支払元を別々に記録。ログイン利用者の既定値から入力を始め、変更も可能
- 支払元ごとの任意の財布残高、初期残高・補充履歴・支出差し引き
- 月予算、固定費、メール分類ルールの保存。Gmailの読み取り・自動分類・自動起票は行わない
- 家族全員が家族用帳簿の支出を閲覧・入力。管理者だけがユーザー、マスタ、予算、設定を変更

収入と個人用記録はこの帳簿に登録しません。支出ごとの非公開設定や個人帳簿との接続もありません。

## ファイル

- `Code.gs` — OAuth認可URL生成、`/usercallback`の認証コード交換、Google IDトークン検証、セッション・権限確認、シートの読み書き、財布計算
- `Index.html`、`Styles.html`、`Client.html` — ログイン後の画面と操作
- `scripts/deploy-family-webapp.sh` — セッション世代を更新して、既存の家族用ウェブアプリURLへデプロイ
- `appsscript.json` — V8ランタイム、ウェブアプリ実行設定、必要なApps Scriptスコープ
- `gas/webapp-pilot-checks/` — Node.jsバックエンド確認とPlaywright画面確認
- [家族帳簿の初期設定とバックアップ移行](../../docs/gas-family-ledger-migration.md)

## 必要なシート

初期化処理は次のシートと列見出しを作成します。既存シートがある場合は削除せず、見出しが一致することを確認します。

| シート | 内容 |
| --- | --- |
| `Users` | Googleメール、表示名、権限、既定利用者、有効状態 |
| `Members` | 支出の利用者 |
| `PaymentSources` | 支払元と財布残高の有効状態 |
| `Categories` | 支出カテゴリ |
| `Places` | 場所 |
| `Expenses` | 家族支出。利用者と支払元を別IDで保存し、再送防止IDと内容ハッシュも記録 |
| `WalletHistory` | 財布の初期残高・補充。補充の再送防止IDと内容ハッシュも記録 |
| `Requests` | 支出・財布補充の冪等な要求記録と内容ハッシュ。画面には公開しない |
| `Budget` | 月予算 |
| `FixedCosts` | 固定費の設定値 |
| `EmailRules` | メール分類ルールの設定値 |

初期利用者は「自分」「パートナー」「共通／家族」です。初期支払元は「パートナー現金」（財布残高あり）と「家族カード」（財布残高なし）です。初期カテゴリは支出用だけです。

## 初期設定

1. 家族用スプレッドシートを管理者のGoogleアカウントで作ります。アプリ利用者へスプレッドシートを共有しないでください。
2. スプレッドシートに`Users`シートを作り、1行目を次の列にします。

   ```text
   email | name | role | defaultMemberId | active | updatedBy | updatedAt
   ```

3. 2行目に最初の管理者を登録します。`email`はGoogleアカウントのメール、`role`は`admin`、`defaultMemberId`は`member-self`、`active`は`TRUE`にします。メールアドレスは大文字・小文字を区別せず比較します。
4. Apps Scriptプロジェクトの **プロジェクトの設定 → スクリプト プロパティ** に次の値を登録します。

   | プロパティ | 値 |
   | --- | --- |
   | `FAMILY_SPREADSHEET_ID` | 手順1のスプレッドシートIDまたはURL |
   | `GOOGLE_OAUTH_CLIENT_ID` | 任意。設定すると、アプリ内蔵のウェブ用OAuthクライアントIDを上書きします |
   | `GOOGLE_OAUTH_CLIENT_SECRET` | 必須。手順5で作成する同じOAuthクライアントのシークレット |

   `GOOGLE_OAUTH_CLIENT_ID`が未設定の場合は、次のウェブ用OAuthクライアントIDを使います。Google Cloud側のOAuth設定を変更する場合は、スクリプトプロパティへ新しいクライアントIDを登録してください。

   ```text
   971274774993-0qpfrqc5i8ct48kq5r2sb7sa7h5s4pou.apps.googleusercontent.com
   ```

   `appsscript.json`にはApps Scriptのプロパティ読書きに必要な`https://www.googleapis.com/auth/script.storage`と、Apps Script上の実行アカウント情報の取得に使う`https://www.googleapis.com/auth/userinfo.email`も宣言します。前者はアプリセッションの保存・失効に必要な権限、後者は再承認確認時に実行アカウントのメールが空でないことを確認する権限です。どちらもGoogleログインの認可URLで要求する`openid email`とは別です。[Google公式Codelab](https://codelabs.developers.google.com/codelabs/gmail-add-ons)ではProperties Serviceの読書きに`script.storage`を指定し、[Apps Scriptの公式スコープ説明](https://developers.google.com/apps-script/concepts/scopes)では`requireAllScopes`による全宣言スコープの確認を説明しています。[Google OAuthスコープ一覧](https://developers.google.com/identity/protocols/oauth2/scopes)では`userinfo.email`をGoogleアカウントのメールアドレス参照として定義しています。

5. Google CloudでOAuth同意画面とウェブアプリ用OAuthクライアントを準備し、次のURIを「承認済みのリダイレクトURI」へ完全一致で登録します。

   ```text
   https://script.google.com/macros/d/1zhqVIRy5YKrDURd77Tl5I4Za4f-1kvGqyJbvwnesW1HLFt8j7InXa3sQ/usercallback
   ```

   OAuth認可URLが許可するGoogleログイン情報のスコープは従来どおり`openid email`だけです。今回宣言する`userinfo.email`はApps Script側の実行アカウント確認用で、ログイン利用者の認証や`Users`照合には使いません。クライアントシークレットをApps Scriptの **プロジェクトの設定 → スクリプト プロパティ** に`GOOGLE_OAUTH_CLIENT_SECRET`として登録します。ソースコード、HTML、ログ、スプレッドシートへシークレットを書かないでください。IDを上書きする場合は、そのIDと対になるシークレットを設定してください。
6. claspまたはApps Scriptエディタから、最新の`Code.gs`と`appsscript.json`を同期します。`authorizeFamilyLedgerServices_`は末尾`_`により`google.script.run`から呼び出せない非公開関数です。全宣言スコープを確認する`ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL)`と、実行アカウントのメールが空でないことを確認する処理を含みます。メールアドレス自体は保存・表示・ログ出力せず、アプリの認証にも使用しません。

   エディタの実行一覧に`authorizeFamilyLedgerServices_`が表示されない場合は、`Code.gs`を編集せず、Apps Scriptエディタの「ファイルを追加 → スクリプト」から一時ファイル`AuthorizeOnce.gs`を作り、次の関数を追加して保存してください。`authorizeFamilyLedgerServicesEditorRunner`を選び、所有者アカウントで実行します。表示される全スコープの承認を許可してください。

   ```javascript
   /** 一時的な権限確認のために実行し、確認後はこのファイルを削除してください。 */
   function authorizeFamilyLedgerServicesEditorRunner() {
     return authorizeFamilyLedgerServices_();
   }
   ```

   実行が成功したら`AuthorizeOnce.gs`ファイルを削除してください。削除後に実行一覧から関数が消えるのは想定どおりです。公開RPCとして残さず、この一時ファイルを含む状態でデプロイしないでください。専用デプロイスクリプトも、プロジェクト配下の`.gs`/`.js`ファイルを再帰確認し、この関数が残っていればデプロイを拒否します。

   承認確認関数は全宣言スコープを明示的に要求し、実行アカウントのメールが空でないことを確認します。メールアドレスは保存・ログ出力せず、ログイン認証や`Users`照合にも使いません。さらに一意な一時Script Propertyを保存・読戻し・削除し、設定済みスプレッドシートを開き、Googleの公開鍵エンドポイントへ接続し、短時間有効なState Tokenを作成します。台帳・設定値は変更しません。完了文「宣言済みスコープと実行アカウントの承認確認が完了しました。メールアドレスは保存せず、台帳と設定値も変更していません。」をApps Script実行ログに記録します。

   認証処理の診断にはApps Scriptエディタの「実行数」を開きます。`doGet:`の固定ログで画面要求とログイン画面生成を確認し、GoogleからGASのcallbackへ到着すると`authCallback:`のログが続きます。失敗時は「コールバック要求」「認証コード交換」「IDトークン検証」「Usersシート確認」「アプリセッション発行」「画面生成」のどの段階で止まったかを固定文言で記録します。コード、token、state、nonce、セッション、メール、シークレット、生例外は記録しません。`doGet`だけがあり`authCallback`がない場合、callback関数が実行された記録はありません。
7. 管理者のアカウントで開き、Google認証画面からログイン後に設定画面の「初期化する」を実行します。認証コードはGAS内で交換し、IDトークンの検証と許可確認後に画面を返します。既存データを削除せず、不足しているシートと初期マスタだけを作成します。
8. 管理者は設定画面から家族のGoogleアカウントを追加し、`defaultMemberId`、表示名、権限を設定します。利用者はそれぞれのGoogleアカウントでログインできます。

## 公開前の安全確認

初回状態の`appsscript.json`と既存デプロイは`MYSELF`アクセスです。クライアントシークレットとCloud ConsoleのリダイレクトURIを管理者が確認し、非公開の実デプロイでコールバックと認証コード交換を確認するまで、この制限を維持してください。今回の更新ではデプロイのアクセス範囲を変更しません。

家族ユーザーへ公開する設定変更は、次の条件をすべて実デプロイで確認した後に行います。実行ユーザーは**自分として実行**を維持し、デプロイのアクセス範囲をログイン必須のGoogleアカウント利用者へ設定します。画面が読み込めても、各台帳操作はサーバーでアプリセッションと`Users`シートを毎回検証します。ウェブアプリURLを知っているだけではシートの読み書きはできません。

- Google CloudのOAuthクライアントに上記の`/usercallback`リダイレクトURIを登録でき、認証コード交換が成功する。
- 管理者アカウントでstateとnonce検証、許可ユーザーのログインを確認し、未登録・停止中ユーザーが拒否される。
- Google IDトークンに対し、Googleの`https://www.googleapis.com/oauth2/v3/certs`から取得したJWKSのRSA公開鍵でRS256署名を検証できる。検証はGAS内で行い、鍵IDが未知の場合はJWKSを再取得する。Googleから鍵を取得できない場合は認証を拒否する。
- `iss`、`aud`、`azp`（存在する場合）、`exp`、`iat`、`sub`、`email_verified`を検査する。検証後にだけメールを許可リストへ照合する。
- 許可ユーザーはログインして操作でき、未登録・停止中アカウント、署名改変、期限切れ・宛先不一致トークンは拒否される。

ウェブ用OAuthクライアントIDはアプリに設定済みです。スクリプトプロパティに別のIDを登録した場合はそちらを使います。管理者本人の実Googleログイン成功は確認済みです。別の家族ユーザーによるログインと利用停止時の実環境確認は未完了で、`appsscript.json`と既存デプロイのアクセス範囲は`MYSELF`のままです。シークレットはサーバー側のコード交換だけに使い、認可URL・画面・ログ・シートへ出しません。アクセストークンと更新トークンは保存しません。

今回の`userinfo.email`追加は、同様の症状について[Google公式のApps Script OAuth2 issue #107](https://github.com/googleworkspace/apps-script-oauth2/issues/107#issuecomment-375887160)に解消報告があることから試す診断上の仮説です。この報告だけでは今回の原因は断定できません。追加後の管理者本人による実Googleログイン成功は確認済みです。

GASのIDトークン検証は、GAS V8のBigIntによるRSA PKCS#1 v1.5/SHA-256検証です。JWKSのキャッシュ期限はGoogleの`Cache-Control: max-age`に従い、鍵の取得や署名検証ができないときに未検証のメールやpayloadへ切り替えません。認証コード交換後は、確認済みのメールアドレスだけを使って高エントロピーの不透明なアプリセッションを発行します。Google IDトークン、アクセストークン、更新トークンはブラウザー、シート、Script Propertiesへ保存しません。アプリセッションの生値はブラウザーの`localStorage`だけに保存し、サーバーはSHA-256ハッシュをキーにしてメール・デプロイ世代・作成時刻だけをScript Propertiesへ保存します。各台帳操作のたびにセッション世代と`Users`シートを確認し、利用停止ユーザーは次の操作から拒否します。ログアウト時はサーバー記録を失効させ、ブラウザー値も削除します。

正常取得した家計データと取得日時もブラウザーの`localStorage`へ保存します。同じセッションとデプロイ世代で開き直した場合だけ前回値を先に表示し、最新データと現在の`Users`権限を背景で確認します。確認中や通信失敗中は集計・月切り替え・フィルター・カレンダーを閲覧できますが、入力・設定・削除は停止します。通信失敗時は「再確認する」から再試行でき、成功するとユーザー権限・画面・保存値を更新して編集を有効にします。保存破損・容量不足・保存機能が利用できない環境では、最新データの取得後に表示します。初期化待ちや新規Googleログインでは以前の家計データを先に表示しません。

ログアウトとサーバーで確認した利用停止・セッション失効では、ブラウザーのセッションと家計データを削除します。別タブのログアウト・セッション変更でも古い画面を解除し、起動・再試行・保存の遅延応答で復元しません。利用停止をサーバーで確認する前には、このブラウザーに残る前回値が表示されます。共有端末では利用後にログアウトしてください。HTML自体の到着待ちは残り、実GASの通信時間短縮は保証しません。

セッションに固定期限はありません。同じブラウザーの再読み込み後も復元され、別ブラウザーや端末とは共有されません。明示的ログアウト、利用停止、または次のデプロイ世代更新で無効になります。デプロイごとに世代を更新し既存URLを維持するため、家族用ウェブアプリの更新にはリポジトリルートから専用スクリプトを使ってください。Apps Scriptエディタの「デプロイを管理」で既存のウェブアプリデプロイIDを確認します。まずdry-runで確認し、実行時はそのIDを環境変数から渡します。

```sh
FAMILY_WEBAPP_DEPLOYMENT_ID='既存のデプロイID' scripts/deploy-family-webapp.sh --dry-run
FAMILY_WEBAPP_DEPLOYMENT_ID='既存のデプロイID' scripts/deploy-family-webapp.sh
```

スクリプトはNode.jsとログイン済みのclaspを使い、`gas/webapp-pilot/.clasp.json`の家族用GASプロジェクトから`clasp push --force --json`を実行します。出力に`Code.gs`と`appsscript.json`の両方が含まれることを確認できた場合だけ、指定した既存デプロイIDを更新します。claspがpushを省略した場合、JSONが不正な場合、またはいずれかのファイルを同期したと確認できない場合はデプロイしません。環境変数がない場合はソースを変更せずに終了します。世代が古いセッション記録は新規ログイン時に整理します。Apps Scriptエディタから直接更新するときはセッション世代が更新されないため、家族用ウェブアプリでは専用スクリプトを標準手順にしてください。

## 開発時の確認

Node.js 24とPlaywrightが必要です。

```sh
cd gas/webapp-pilot-checks
node scripts/backend-check.mjs
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright" node scripts/visual-check.mjs
```

バックエンド確認では認可URLとState Token、state/nonce、認証コード交換、IDトークンの署名と権限ゲート、アプリセッションの発行・ハッシュ保存・認証・失効・旧世代整理・利用停止時の拒否、サービス承認完了ログ、シート初期化・保存、数式形式の文字列をリッチテキストとして保存・再読込する動作、ユーザーメール変更、要求IDによる重複保存防止、利用者と支払元の分離、財布計算、バックアップの公開可視性・非支出カテゴリ除外を検証します。Playwright確認はローカル用の模擬データを使い、セッションの再読み込み復元に加え、前回値の即表示・全変更経路の停止・確認日時・通信失敗と再試行・一般利用者の復元・権限降格・保存破損/不可・世代/セッション分離・ログアウト/別タブ/遅延応答・初期化待ちを確認します。実Googleログイン、実GAS callback、Google Cloud設定は確認しません。
