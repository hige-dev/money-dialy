import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const checksDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDirectory = path.resolve(checksDirectory, "../..");
const sourceScript = path.join(repositoryDirectory, "scripts/deploy-family-webapp.sh");
const sourceCode = path.join(repositoryDirectory, "gas/webapp-pilot/Code.gs");
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "family-webapp-deploy-guard-"));

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

try {
  const scriptDirectory = path.join(temporaryDirectory, "scripts");
  const projectDirectory = path.join(temporaryDirectory, "gas/webapp-pilot");
  const temporaryFileDirectory = path.join(projectDirectory, "temporary");
  const fakeBinDirectory = path.join(temporaryDirectory, "fake-bin");
  const copiedScript = path.join(scriptDirectory, "deploy-family-webapp.sh");
  const copiedCode = path.join(projectDirectory, "Code.gs");
  const claspMarker = path.join(temporaryDirectory, "clasp-invocations.txt");
  fs.mkdirSync(scriptDirectory, { recursive: true });
  fs.mkdirSync(projectDirectory, { recursive: true });
  fs.mkdirSync(temporaryFileDirectory, { recursive: true });
  fs.mkdirSync(fakeBinDirectory, { recursive: true });
  fs.copyFileSync(sourceScript, copiedScript);
  const cleanCode = fs.readFileSync(sourceCode, "utf8");
  const generationMatch = cleanCode.match(/^const FAMILY_WEBAPP_SESSION_GENERATION_ = '([0-9]+)';$/m);
  assert.ok(generationMatch, "Code.gsから現在のセッション世代を読み取れます");
  const nextGeneration = (BigInt(generationMatch[1]) + 1n).toString();
  fs.writeFileSync(copiedCode, `${cleanCode}\nfunction authorizeFamilyLedgerServicesEditorRunner() {\n  return authorizeFamilyLedgerServices_();\n}\n`);

  const fakeClasp = path.join(fakeBinDirectory, "clasp");
  fs.writeFileSync(fakeClasp, [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    "const args = process.argv.slice(2);",
    "fs.appendFileSync(process.env.CLASP_MARKER, args.join(' ') + '\\n');",
    "if (args[0] === '--version') console.log('3.4.1');",
    "else if (args[0] === 'push') {",
    "  if (process.env.CLASP_PUSH_MODE === 'skipped') console.log('Skipping push.');",
    "  else if (process.env.CLASP_PUSH_MODE === 'up-to-date') console.log('[]');",
    "  else if (process.env.CLASP_PUSH_MODE === 'missing-manifest') console.log(JSON.stringify(['Code.gs']));",
    "  else if (process.env.CLASP_PUSH_MODE === 'missing-code') console.log(JSON.stringify(['appsscript.json']));",
    "  else console.log(JSON.stringify(['Code.gs', 'appsscript.json']));",
    "}",
    "else if (args[0] === 'deploy') console.log('deployment updated');",
  ].join("\n") + "\n");
  fs.chmodSync(fakeClasp, 0o755);

  const environment = {
    ...process.env,
    CLASP_MARKER: claspMarker,
    CLASP_PUSH_MODE: "success",
    FAMILY_WEBAPP_DEPLOYMENT_ID: "dry-run-only",
    PATH: [fakeBinDirectory, path.dirname(process.execPath), process.env.PATH || ""].join(path.delimiter),
  };
  const guardedSourceHash = sha256(copiedCode);

  for (const argumentsList of [["--dry-run"], []]) {
    const result = spawnSync("/bin/bash", [copiedScript, ...argumentsList], {
      cwd: temporaryDirectory,
      env: environment,
      encoding: "utf8",
    });
    assert.equal(result.error, undefined, "デプロイガード確認の起動に失敗しません");
    assert.notEqual(result.status, 0, "一時公開RPCが残る場合はデプロイを拒否します");
    assert.match(result.stderr, /一時的なエディタ用公開RPCが家族用GASソースに残っています/, "日本語の拒否理由を表示します");
    assert.equal(sha256(copiedCode), guardedSourceHash, "拒否時にCode.gsを書き換えません");
    assert.equal(fs.existsSync(claspMarker), false, "拒否時にclaspを実行しません");
    assert.equal(fs.existsSync(path.join(projectDirectory, ".family-webapp-deploy.lock")), false, "拒否時にデプロイロックを作りません");
  }

  fs.writeFileSync(copiedCode, cleanCode);
  const separateRunner = path.join(temporaryFileDirectory, "AuthorizeOnce.gs");
  fs.writeFileSync(separateRunner, "function authorizeFamilyLedgerServicesEditorRunner() { return authorizeFamilyLedgerServices_(); }\n");
  const separateRunnerHash = sha256(separateRunner);
  for (const argumentsList of [["--dry-run"], []]) {
    const result = spawnSync("/bin/bash", [copiedScript, ...argumentsList], {
      cwd: temporaryDirectory,
      env: environment,
      encoding: "utf8",
    });
    assert.equal(result.error, undefined, "別ファイル内の一時公開RPC確認の起動に失敗しません");
    assert.notEqual(result.status, 0, "再帰検索で別ファイル内の一時公開RPCを拒否します");
    assert.match(result.stderr, /一時的なエディタ用公開RPCが家族用GASソースに残っています/, "別ファイルでも日本語の拒否理由を表示します");
    assert.equal(sha256(separateRunner), separateRunnerHash, "拒否時に別ファイルを変更しません");
    assert.equal(fs.existsSync(claspMarker), false, "別ファイルの拒否時はclaspを実行しません");
  }
  fs.unlinkSync(separateRunner);
  const cleanSourceHash = sha256(copiedCode);
  const dryRun = spawnSync("/bin/bash", [copiedScript, "--dry-run"], {
    cwd: temporaryDirectory,
    env: environment,
    encoding: "utf8",
  });
  assert.equal(dryRun.error, undefined, "通常のドライラン確認の起動に失敗しません");
  assert.equal(dryRun.status, 0, `一時公開RPCがないドライランが成功します: ${dryRun.stderr}`);
  assert.match(dryRun.stdout, /ドライラン:/, "デプロイ予定を表示します");
  assert.equal(sha256(copiedCode), cleanSourceHash, "ドライランではCode.gsを書き換えません");
  assert.equal(fs.readFileSync(claspMarker, "utf8").trim(), "--version", "ドライランではclaspのバージョン確認だけを実行します");

  fs.writeFileSync(claspMarker, "");
  const deploy = spawnSync("/bin/bash", [copiedScript], {
    cwd: temporaryDirectory,
    env: environment,
    encoding: "utf8",
  });
  assert.equal(deploy.error, undefined, "検証済みデプロイの起動に失敗しません");
  assert.equal(deploy.status, 0, `Code.gs同期確認後のデプロイが成功します: ${deploy.stderr}`);
  assert.match(fs.readFileSync(claspMarker, "utf8"), /push --force --json/, "manifest確認を自動承認してJSON形式でpushします");
  assert.match(deploy.stdout, /同じデプロイIDの家族用ウェブアプリを更新しました/, "同期確認後のデプロイ成功を表示します");
  assert.ok(fs.readFileSync(claspMarker, "utf8").includes(`deploy -i dry-run-only -d 家族用ウェブアプリ 世代 ${nextGeneration}`), "push後にCode.gsから算出した次世代で同じデプロイIDだけを更新します");

  for (const skippedMode of ["skipped", "up-to-date", "missing-manifest", "missing-code"]) {
    fs.writeFileSync(claspMarker, "");
    const skippedEnvironment = { ...environment, CLASP_PUSH_MODE: skippedMode };
    const skippedPush = spawnSync("/bin/bash", [copiedScript], {
      cwd: temporaryDirectory,
      env: skippedEnvironment,
      encoding: "utf8",
    });
    assert.equal(skippedPush.error, undefined, `${skippedMode} push確認の起動に失敗しません`);
    assert.notEqual(skippedPush.status, 0, `${skippedMode}の場合は失敗します`);
    assert.match(skippedPush.stderr, /Code\.gsとappsscript\.jsonの同期を確認できませんでした/, "同期できないときに日本語の拒否理由を表示します");
    assert.doesNotMatch(fs.readFileSync(claspMarker, "utf8"), /^deploy /m, `${skippedMode}の場合はdeployしません`);
  }

  console.log("デプロイガード確認: 一時公開RPCと、Code.gsまたはappsscript.jsonのpushを確認できない状態ではdeployしないことを確認しました。");
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
