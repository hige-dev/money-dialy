#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 || ( $# -eq 1 && "$1" != "--dry-run" ) ]]; then
  printf '%s\n' '使い方: scripts/deploy-family-webapp.sh [--dry-run]' >&2
  exit 2
fi

deployment_id="${FAMILY_WEBAPP_DEPLOYMENT_ID:-}"
if [[ -z "$deployment_id" ]]; then
  printf '%s\n' 'FAMILY_WEBAPP_DEPLOYMENT_IDを設定してください。ソースは変更していません。' >&2
  exit 1
fi
if [[ ! "$deployment_id" =~ ^[A-Za-z0-9_-]+$ ]]; then
  printf '%s\n' 'FAMILY_WEBAPP_DEPLOYMENT_IDに使用できない文字があります。ソースは変更していません。' >&2
  exit 1
fi
if ! command -v clasp >/dev/null 2>&1; then
  printf '%s\n' 'claspコマンドが見つかりません。インストールとログイン状態を確認してください。ソースは変更していません。' >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.jsコマンドが見つかりません。インストール状態を確認してください。ソースは変更していません。' >&2
  exit 1
fi

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_directory="$(cd -- "$script_directory/../gas/webapp-pilot" && pwd)"
code_file="$project_directory/Code.gs"
lock_directory="$project_directory/.family-webapp-deploy.lock"
dry_run=false
if [[ "${1:-}" == "--dry-run" ]]; then dry_run=true; fi

if ! node - "$project_directory" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const projectDirectory = path.resolve(process.argv[2]);
const ignoredDirectories = new Set(['.git', 'node_modules']);
const sourceExtensions = new Set(['.gs', '.js']);

function listServerSources(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : listServerSources(entryPath);
    }
    return entry.isFile() && sourceExtensions.has(path.extname(entry.name).toLowerCase()) ? [entryPath] : [];
  });
}

try {
  for (const file of listServerSources(projectDirectory)) {
    if (fs.readFileSync(file, 'utf8').includes('authorizeFamilyLedgerServicesEditorRunner')) {
      console.error('一時的なエディタ用公開RPCが家族用GASソースに残っています。削除してから再実行してください。ソースとデプロイは変更していません。');
      process.exit(1);
    }
  }
} catch (error) {
  console.error(`家族用GASのソースを確認できませんでした。ソースとデプロイは変更していません: ${error.message}`);
  process.exit(1);
}
NODE
then
  exit 1
fi

clasp_version="$(clasp --version)"
if [[ "$dry_run" != true ]]; then
  if ! mkdir "$lock_directory" 2>/dev/null; then
    printf '%s\n' '別のデプロイ処理が実行中です。完了後にもう一度お試しください。' >&2
    exit 1
  fi
  trap 'rmdir "$lock_directory" 2>/dev/null || true' EXIT
fi

generation_info="$(node - "$code_file" "$dry_run" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const dryRun = process.argv[3] === 'true';
try {
  const source = fs.readFileSync(file, 'utf8');
  const match = source.match(/^const FAMILY_WEBAPP_SESSION_GENERATION_ = '([0-9]+)';$/m);
  if (!match) throw new Error('Code.gsのセッション世代定数を確認できません。');
  const current = BigInt(match[1]);
  const next = current + 1n;
  if (next.toString().length > 18) throw new Error('セッション世代が上限を超えました。');
  if (!dryRun) {
    const updated = source.replace(match[0], `const FAMILY_WEBAPP_SESSION_GENERATION_ = '${next}';`);
    const temporary = `${file}.${process.pid}.tmp`;
    const mode = fs.statSync(file).mode & 0o777;
    fs.writeFileSync(temporary, updated, { encoding: 'utf8', mode, flag: 'wx' });
    fs.renameSync(temporary, file);
  }
  process.stdout.write(`${current} ${next}`);
} catch (error) {
  console.error(`セッション世代を確認または更新できませんでした: ${error.message}`);
  process.exit(1);
}
NODE
)"
read -r current_generation next_generation <<< "$generation_info"

if [[ "$dry_run" == true ]]; then
  printf 'ドライラン: セッション世代を %s から %s へ更新し、同じデプロイIDを更新します。\n' "$current_generation" "$next_generation"
  printf '確認したclasp: %s\n' "$clasp_version"
  printf '実行予定: clasp push --force --json（Code.gsとappsscript.jsonの同期を確認）\n'
  printf '実行予定: clasp deploy -i FAMILY_WEBAPP_DEPLOYMENT_ID -d "家族用ウェブアプリ 世代 %s"\n' "$next_generation"
  printf '%s\n' 'ソースと本番デプロイは変更していません。'
  exit 0
fi

cd "$project_directory"
printf 'セッション世代を %s から %s へ更新しました。\n' "$current_generation" "$next_generation"
# --forceはマニフェスト上書き確認を省くだけなので、push結果に両ファイルが含まれる場合だけ続行します。
if ! pushed_files="$(clasp push --force --json)"; then
  printf '%s\n' 'clasp pushに失敗しました。デプロイは行っていません。' >&2
  exit 1
fi
if ! node - "$pushed_files" <<'NODE'
const output = process.argv[2] || '';
try {
  const files = JSON.parse(output);
  const pushedBasenames = new Set(Array.isArray(files) ? files
    .filter((file) => typeof file === 'string')
    .map((file) => file.replace(/\\/g, '/').split('/').at(-1)) : []);
  const requiredFiles = ['Code.gs', 'appsscript.json'];
  const missingFiles = requiredFiles.filter((file) => !pushedBasenames.has(file));
  if (missingFiles.length > 0) throw new Error();
} catch {
  console.error('clasp pushでCode.gsとappsscript.jsonの同期を確認できませんでした。デプロイは行っていません。');
  process.exit(1);
}
NODE
then
  exit 1
fi
clasp deploy -i "$deployment_id" -d "家族用ウェブアプリ 世代 $next_generation"
printf '%s\n' '同じデプロイIDの家族用ウェブアプリを更新しました。'
