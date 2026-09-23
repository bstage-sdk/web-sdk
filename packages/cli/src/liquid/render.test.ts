import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { LiquidPreviewError, createEngine, renderTemplate } from './render.js'

let root: string

/** public/{type}/{name}/ 에 템플릿 한 벌을 쓴다. data가 undefined면 data.json을 만들지 않는다. */
function writeTemplate(type: string, name: string, source: string, data?: string): void {
  const dir = join(root, 'public', type, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'template.liquid'), source)
  if (data !== undefined) writeFileSync(join(dir, 'data.json'), data)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bstage-liquid-render-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('renderTemplate', () => {
  it('data.json 값을 컨텍스트로 넣어 렌더한다', async () => {
    writeTemplate('user', 'home', '<h1>{{ heading }}</h1>', '{"heading":"안녕하세요"}')

    const result = await renderTemplate(createEngine(root), root, 'user', 'home')

    expect(result.html).toBe('<h1>안녕하세요</h1>')
  })

  it('data.json이 없으면 빈 컨텍스트로 렌더한다', async () => {
    writeTemplate('admin', 'panel', '<p>[{{ heading }}]</p>')

    const result = await renderTemplate(createEngine(root), root, 'admin', 'panel')

    expect(result.html).toBe('<p>[]</p>')
  })

  it('parse_json 필터로 문자열 안의 JSON을 객체로 바꾼다', async () => {
    writeTemplate(
      'user',
      'home',
      '{% assign parsed = payload | parse_json %}<b>{{ parsed.count }}</b>',
      '{"payload":"{\\"count\\":7}"}',
    )

    const result = await renderTemplate(createEngine(root), root, 'user', 'home')

    expect(result.html).toBe('<b>7</b>')
  })

  it('중첩 이름(a/b)도 읽는다 — 빌더 규약 밖이지만 프리뷰는 보여준다', async () => {
    writeTemplate('user', join('events', 'summer'), '<i>{{ heading }}</i>', '{"heading":"여름"}')

    const result = await renderTemplate(createEngine(root), root, 'user', 'events/summer')

    expect(result.html).toBe('<i>여름</i>')
  })

  it('data.json이 깨졌으면 파일 경로를 담은 LiquidPreviewError를 던진다', async () => {
    writeTemplate('user', 'home', '<h1>{{ heading }}</h1>', '{ not json ')

    const err = await renderTemplate(createEngine(root), root, 'user', 'home').catch((e) => e)

    expect(err).toBeInstanceOf(LiquidPreviewError)
    expect((err as LiquidPreviewError).message).toContain('data.json 파싱 실패')
    expect((err as LiquidPreviewError).file).toBe(join(root, 'public', 'user', 'home', 'data.json'))
  })

  it('템플릿 문법 오류는 줄 번호를 담은 LiquidPreviewError로 감싼다', async () => {
    writeTemplate('user', 'home', '<h1>ok</h1>\n{% badtag %}\n')

    const err = await renderTemplate(createEngine(root), root, 'user', 'home').catch((e) => e)

    expect(err).toBeInstanceOf(LiquidPreviewError)
    expect((err as LiquidPreviewError).file).toBe(
      join(root, 'public', 'user', 'home', 'template.liquid'),
    )
    expect((err as LiquidPreviewError).line).toBe(2)
  })

  it('template.liquid가 없으면 LiquidPreviewError를 던진다', async () => {
    const err = await renderTemplate(createEngine(root), root, 'user', 'missing').catch((e) => e)

    expect(err).toBeInstanceOf(LiquidPreviewError)
    expect((err as LiquidPreviewError).file).toBe(
      join(root, 'public', 'user', 'missing', 'template.liquid'),
    )
  })
})
