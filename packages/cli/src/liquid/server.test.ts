import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { startLiquidDevServer, type LiquidDevServer } from './server.js'

let root: string
let server: LiquidDevServer | undefined

/** 1x1 투명 PNG — content-type 판정을 확인하려고 실제 바이트를 쓴다. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

function writeFileIn(relPath: string, content: string | Buffer): void {
  const full = join(root, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

/** 포트 0으로 띄우고 베이스 URL을 돌려준다 — 병렬 실행에서 포트가 겹치지 않게. */
async function start(): Promise<string> {
  server = await startLiquidDevServer({ root, port: 0 })
  return `http://127.0.0.1:${server.port}`
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bstage-liquid-server-'))
  writeFileIn('public/user/home/template.liquid', '<h1>{{ heading }}</h1>')
  writeFileIn('public/user/home/data.json', '{"heading":"안녕하세요"}')
  writeFileIn('public/user/home/pixel.png', PNG_1X1)
})

afterEach(async () => {
  await server?.close()
  server = undefined
  rmSync(root, { recursive: true, force: true })
})

describe('startLiquidDevServer', () => {
  it('목록 페이지에 템플릿 이름과 링크가 있다', async () => {
    const base = await start()

    const res = await fetch(`${base}/user`)
    const html = await res.text()

    expect(res.status).toBe(200)
    expect(html).toContain('home')
    expect(html).toContain('/user/home')
  })

  it('index에 user·admin 목록 링크가 있다', async () => {
    const base = await start()

    const html = await (await fetch(`${base}/`)).text()

    expect(html).toContain('/user')
    expect(html).toContain('/admin')
  })

  it('템플릿을 data.json 값으로 렌더한다', async () => {
    const base = await start()

    const res = await fetch(`${base}/user/home`)
    const html = await res.text()

    expect(res.status).toBe(200)
    expect(html).toContain('안녕하세요')
  })

  it('렌더 페이지에 리로드 스크립트를 주입한다', async () => {
    const base = await start()

    const html = await (await fetch(`${base}/user/home`)).text()

    expect(html).toContain('/__bstage__/reload')
  })

  it('없는 템플릿은 404', async () => {
    const base = await start()

    const res = await fetch(`${base}/user/nope`)

    expect(res.status).toBe(404)
  })

  it('정적 파일은 확장자로 content-type을 정한다', async () => {
    const base = await start()

    const res = await fetch(`${base}/user/home/pixel.png`)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect((await res.arrayBuffer()).byteLength).toBe(PNG_1X1.byteLength)
  })

  it('data.json이 깨졌으면 500이 아니라 파일명을 담은 오류 페이지 200을 준다', async () => {
    writeFileIn('public/user/home/data.json', '{ not json ')
    const base = await start()

    const res = await fetch(`${base}/user/home`)
    const html = await res.text()

    expect(res.status).toBe(200)
    expect(html).toContain('data.json')
    expect(html).toContain('자동으로 다시 불러옵니다')
  })

  it('빌더 규약 밖(중첩) 템플릿은 목록에서 무시된다고 알린다', async () => {
    writeFileIn('public/user/events/summer/template.liquid', '<i>nested</i>')
    const base = await start()

    const html = await (await fetch(`${base}/user`)).text()

    expect(html).toContain('events/summer')
    expect(html).toContain('포털이 무시합니다')
  })

  it('public/ 밖 파일은 내보내지 않는다', async () => {
    writeFileIn('secret.txt', 'top secret')
    const base = await start()

    const res = await fetch(`${base}/../secret.txt`, { redirect: 'manual' })

    expect(res.status).toBe(404)
  })

  it('public/ 안의 심볼릭 링크가 밖을 가리키면 내보내지 않는다', async () => {
    writeFileIn('public/user/home/template.liquid', '<p>x</p>')
    const outside = join(root, 'secret.txt')
    writeFileSync(outside, 'top secret', 'utf-8')
    symlinkSync(outside, join(root, 'public', 'user', 'home', 'leak.txt'))
    const base = await start()

    const res = await fetch(`${base}/user/home/leak.txt`)
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('top secret')
  })

  it('루프백 주소에만 바인딩한다', async () => {
    await start()
    expect(server?.host).toBe('127.0.0.1')
  })

  it('템플릿 목록은 요청마다 다시 훑지 않는다', async () => {
    const base = await start()
    const before = server?.scans()

    await fetch(`${base}/user`)
    await fetch(`${base}/user/home`)
    await fetch(`${base}/user/home/pixel.png`)

    expect(server?.scans()).toBe(before)
  })

  it('감시가 부르는 재계산을 거치면 새로 만든 템플릿이 목록에 나온다', async () => {
    const base = await start()
    expect(await (await fetch(`${base}/user`)).text()).not.toContain('second')

    writeFileIn('public/user/second/template.liquid', '<p>second</p>')
    server?.refresh() // 파일 감시가 리로드 직전에 부르는 것과 같은 경로

    const html = await (await fetch(`${base}/user`)).text()
    expect(html).toContain('second')
    expect(html).toContain('/user/second')
  })

  it('보안 헤더(nosniff·frame-ancestors·CSP)를 HTML과 정적 파일 응답 모두에 붙인다', async () => {
    const base = await start()
    for (const path of ['/user/home', '/user/home/pixel.png']) {
      const res = await fetch(`${base}${path}`)
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('x-frame-options')).toBe('DENY')
      expect(res.headers.get('content-security-policy')).toMatch(/^default-src '(self|none)'/)
    }
  })

  it('Host가 루프백이 아니거나 교차 출처 표시가 있으면 403 (DNS 리바인딩 차단)', async () => {
    await start()
    const port = server?.port ?? 0
    const status = (headers: Record<string, string>): Promise<number> =>
      new Promise((resolve, reject) => {
        const req = httpRequest(
          { host: '127.0.0.1', port, path: '/user/home', method: 'GET', headers },
          (res) => {
            res.resume()
            resolve(res.statusCode ?? 0)
          },
        )
        req.on('error', reject)
        req.end()
      })

    expect(await status({ host: `evil.example:${port}` })).toBe(403)
    expect(await status({ host: `127.0.0.1:${port}`, origin: 'https://evil.example' })).toBe(403)
    expect(await status({ host: `localhost:${port}`, 'sec-fetch-site': 'cross-site' })).toBe(403)
    expect(await status({ host: `localhost:${port}`, 'sec-fetch-site': 'same-origin' })).toBe(200)
    // 다른 localhost 포트의 페이지·sandbox(null) 오리진·same-site도 같은 오리진이 아니다
    expect(await status({ host: `localhost:${port + 1}` })).toBe(403)
    expect(
      await status({ host: `localhost:${port}`, origin: `http://localhost:${port + 1}` }),
    ).toBe(403)
    expect(await status({ host: `localhost:${port}`, origin: 'null' })).toBe(403)
    expect(await status({ host: `localhost:${port}`, 'sec-fetch-site': 'same-site' })).toBe(403)
    expect(await status({ host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` })).toBe(
      200,
    )
    expect(await status({ host: `localhost:${port}`, 'sec-fetch-site': 'none' })).toBe(200)
  })

  it('정적 파일은 스크립트 실행을 막는 CSP(sandbox)를, SSE도 보안 헤더를 받는다', async () => {
    const base = await start()
    const asset = await fetch(`${base}/user/home/pixel.png`)
    expect(asset.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")

    const ac = new AbortController()
    const sse = await fetch(`${base}/__bstage__/reload`, { signal: ac.signal })
    expect(sse.headers.get('x-content-type-options')).toBe('nosniff')
    expect(sse.headers.get('x-frame-options')).toBe('DENY')
    ac.abort()
  })

  it('요청 한 건을 로그 콜백 한 줄로 남긴다', async () => {
    const lines: string[] = []
    server = await startLiquidDevServer({ root, port: 0, log: (l) => lines.push(l) })

    await fetch(`http://127.0.0.1:${server.port}/user/home`)

    expect(lines).toContain('GET /user/home 200')
  })
})
