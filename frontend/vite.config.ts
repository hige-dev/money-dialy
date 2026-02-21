import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { execSync } from 'child_process'
import { readFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const LAMBDA_FUNCTION_NAME = process.env.LAMBDA_FUNCTION_NAME || ''

/**
 * ローカル開発用: /api へのリクエストを aws lambda invoke で直接呼び出す。
 * CloudFront OAC をバイパスし、ローカルの AWS 認証情報を使う。
 */
function lambdaProxy(): Plugin {
  return {
    name: 'lambda-proxy',
    configureServer(server) {
      server.middlewares.use('/api', (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token, x-amz-content-sha256',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
          })
          res.end()
          return
        }

        let body = ''
        req.on('data', (chunk: Buffer) => { body += chunk.toString() })
        req.on('end', () => {
          const outFile = join(tmpdir(), `lambda-${Date.now()}.json`)
          try {
            const event = JSON.stringify({
              requestContext: { http: { method: req.method || 'POST' } },
              headers: {
                'content-type': 'application/json',
                'x-auth-token': req.headers['x-auth-token'] || '',
                'origin': req.headers['origin'] || '',
              },
              body,
            })

            execSync(
              `aws lambda invoke --function-name ${LAMBDA_FUNCTION_NAME} --cli-binary-format raw-in-base64-out --payload '${event.replace(/'/g, "'\\''")}' ${outFile}`,
              { encoding: 'utf-8', timeout: 30000 },
            )

            const lambdaResponse = JSON.parse(readFileSync(outFile, 'utf-8'))
            const statusCode = lambdaResponse.statusCode || 200

            res.writeHead(statusCode, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token, x-amz-content-sha256',
              'Access-Control-Allow-Methods': 'POST, OPTIONS',
            })
            res.end(lambdaResponse.body || '')
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: String(e) }))
          } finally {
            try { unlinkSync(outFile) } catch {}
          }
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), lambdaProxy()],
})
