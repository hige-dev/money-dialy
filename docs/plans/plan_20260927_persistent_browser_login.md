# 計画

## 目的

- `authorizeFamilyLedgerServices` の完了内容をApps Scriptエディタの実行ログに表示する。
- Googleログイン状態をブラウザーごとに保存し、明示的にログアウトするまで再ログインを不要にする。
- 別ブラウザー・別端末では新たにGoogleログインを求める。
- 新しいウェブアプリ版をデプロイしたら、保存済みセッションを無効にして再ログインを求める。

## 現状の調査結果

- `gas/webapp-pilot/Code.gs` はGoogleの認証コードを交換し、IDトークンを検証した後、そのIDトークンを初期画面へ渡している。IDトークンは期限付き。
- `authorize_` は各サーバー操作でIDトークンを検証し、`Users`シートの利用可否と権限を確認する。
- `gas/webapp-pilot/Client.html` はIDトークンをJavaScriptのメモリーだけに保持するため、画面を再読み込みするとログイン状態が失われる。既存のログアウト操作もメモリーを消すだけ。
- `authorizeFamilyLedgerServices` は完了文字列を返すが、Apps Scriptエディタは関数の戻り値を実行ログに表示しない。`Logger.log`または`console.log`を使えば実行ログで確認できる。[Apps Script Logger](https://developers.google.com/apps-script/reference/base/logger)
- `gas/webapp-pilot-checks/scripts/backend-check.mjs` にはOAuth・期限・利用者許可の確認があるが、永続セッション、ログアウトによる失効、デプロイ後の失効を確認するケースはない。
- 家族用GASには専用の`.clasp.json`がある。Claspは既存のdeployment IDを指定して同じURLのデプロイを更新できる。[Claspのデプロイ手順](https://github.com/google/clasp#deployments)
- `PropertiesService`は永続保存に使える。容量は1プロパティあたり9KB、1ストアあたり500KBなので、端末ごとに小さなセッション情報を保存し、ログアウト・世代更新時に不要な情報を削除する。[Apps Scriptの割り当て](https://developers.google.com/apps-script/guides/services/quotas)
- ローカル確認はバックエンド検証スクリプトとPlaywright画面確認を使う。Apps Scriptの実Googleログインはローカルでは再現できない。
- 既存の家族帳簿計画では、Google IDトークンのサーバー検証と`Users`シートによる認可を維持する方針が決まっている。
- `AGENTS.md`は人が読む文章を日本語とし、動作変更後の関連検証を求めている。

## 決定事項

- Google OAuthは本人確認に引き続き使う。Google IDトークンやOAuthの更新トークンはブラウザーやシートへ保存しない。
- OAuth成功後にGASが端末ごとのランダムなアプリセッションを発行する。ブラウザーはセッショントークンを`localStorage`に保存し、サーバーはトークンのハッシュとアカウント、セッション世代をApps Scriptのスクリプトプロパティへ保存する。
- セッション有効期限は設けない。各データ操作でセッションを確認した後、既存どおり`Users`シートの利用可否と権限を照合する。利用停止ユーザーは次の操作から拒否する。
- ログアウト時にサーバー側セッションを失効させ、ブラウザーの`localStorage`からもトークンを削除する。別のブラウザー・端末は別セッションなので、Googleログインが必要。
- 家族用ウェブアプリの専用デプロイスクリプトを用意し、デプロイごとにセッション世代を更新して、既存のdeployment IDへ新バージョンを公開する。URLは維持する。以後のデプロイはこのスクリプトを使う。
- セッション世代が古いレコードは次回ログイン時に整理する。セッション記録・トークンをログへ出さない。
- `authorizeFamilyLedgerServices`は既存の戻り値を維持し、日本語の完了メッセージを実行ログにも出す。シートやプロパティの業務設定は変更しない。

## 解決済みの確認事項

- **ログイン状態の保存期間:** 固定期限を設けず、明示的なログアウト、ユーザーの利用停止、またはデプロイによる世代更新まで有効にする。
- **端末間の共有:** セッションはブラウザー単位とし、別ブラウザー・端末では再ログインする。
- **デプロイ後の扱い:** 家族用専用デプロイスクリプトで世代を更新し、既存deployment IDへ公開する。公開URLは変えない。
- **承認確認関数の表示:** 完了結果をApps Script実行ログへ記録する。

## 対象範囲

- `gas/webapp-pilot/Code.gs` のセッション発行・検証・失効、セッション世代、承認確認ログを実装する。
- `gas/webapp-pilot/Client.html` の起動時セッション復元、ブラウザー保存、ログアウト時の失効を実装する。
- `gas/webapp-pilot-checks/scripts/backend-check.mjs` と画面確認を更新する。
- 家族用GAS専用デプロイスクリプトと、`gas/webapp-pilot/README.md`のログイン・デプロイ手順を整える。
- Lambda、Gmail取込、家計データ形式は変更しない。

## 作業手順

1. サーバー側のセッションIDを発行し、ハッシュ化したキーでスクリプトプロパティへ保存する。入力トークン、署名、世代、ユーザーの有効状態を毎回確認する。
2. OAuthコールバック後にGoogle IDトークンをブラウザーへ渡す経路をアプリセッションへ置き換える。
3. クライアント起動時に`localStorage`からセッションを復元し、ログアウト時はサーバー失効後にローカル保存値を消す。
4. 専用デプロイスクリプトがセッション世代を更新し、既存deployment IDへ同じURLのままデプロイするようにする。
5. `authorizeFamilyLedgerServices`の完了を日本語で実行ログへ出す。
6. バックエンド確認で、セッションの発行・認証・ログアウト・ユーザー停止・世代更新を確認する。画面確認で、再読み込み後の復元、ログアウト後の再ログイン、ブラウザーごとの分離を確認する。
7. READMEとデプロイ手順を更新し、レビューでP0/P1/P2の指摘がなくなるまで修正する。

## 検証

- `node gas/webapp-pilot-checks/scripts/backend-check.mjs`
- `PLAYWRIGHT_BROWSERS_PATH="$PWD/gas/webapp-pilot-checks/.cache/ms-playwright" node gas/webapp-pilot-checks/scripts/visual-check.mjs`
- `git diff --check`
- Apps Script実環境では、同じブラウザーの再読み込み、ログアウト、別ブラウザー、デプロイ後の再ログインを確認する。自動検証できない実環境操作は結果を分けて報告する。

## リスク

- `localStorage`のセッショントークンはブラウザー内の持ち運び可能な認証情報になる。HTTPS経由だけで扱い、画面・ログへ出さず、各操作で有効ユーザーと権限を再確認する。
- 固定期限を設けないため、ログアウトされていないセッションはデプロイまで残る。トークンを紛失・複製した場合はログアウトまたは次回デプロイで失効させる。
- Apps Scriptのプロパティ容量には上限がある。世代が古いセッションを整理し、ログアウト時にも記録を削除する。
- Apps Scriptエディタから直接デプロイすると、世代更新が抜ける可能性がある。専用デプロイスクリプトを標準手順として文書化する。
