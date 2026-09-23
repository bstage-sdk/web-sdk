import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Liquid, LiquidError } from 'liquidjs'

/** 프리뷰가 보여줄 수 있는 형태로 정리한 렌더 실패. 파일·줄을 들고 있어 오류 페이지가 그대로 쓴다. */
export class LiquidPreviewError extends Error {
  constructor(
    message: string,
    readonly file: string,
    readonly line?: number,
  ) {
    super(message)
    this.name = 'LiquidPreviewError'
  }
}

/** 렌더 성공 결과. 지금은 본문뿐이지만 헤더·메타가 붙을 자리를 남겨 둔다. */
export interface RenderResult {
  html: string
}

/** 프리뷰가 인정하는 surface. 빌더 규약과 같다. */
export type LiquidSurface = 'user' | 'admin'

/**
 * 프리뷰용 liquid 엔진.
 *
 * `root`는 프로젝트 루트이고 엔진의 탐색 루트는 `public/`이다 — `{% render %}`·`{% include %}`가
 * public 밖으로 나가지 못하게 하려는 것이다. `strictVariables: false`는 플랫폼과 맞춘 값으로,
 * 로컬에 없는 값(실데이터는 서버가 넣는다)이 빈 문자열로 렌더되게 한다.
 */
export function createEngine(root: string): Liquid {
  const engine = new Liquid({
    root: [join(root, 'public')],
    extname: '.liquid',
    strictVariables: false,
  })

  // 플랫폼이 제공하는 필터와 이름·동작을 맞춘다. 문자열이 아닌 값은 그대로 흘려보내
  // 이미 객체인 데이터에 필터를 걸어도 깨지지 않게 한다.
  engine.registerFilter('parse_json', (value: unknown) =>
    typeof value === 'string' ? JSON.parse(value) : value,
  )

  return engine
}

/** liquidjs 오류에서 줄 번호를 꺼낸다(1-based row). 위치 정보가 없으면 undefined. */
function lineOf(err: unknown): number | undefined {
  if (!LiquidError.is(err)) return undefined
  try {
    const [row] = err.token.getPosition()
    return typeof row === 'number' ? row : undefined
  } catch {
    return undefined
  }
}

/** data.json을 읽는다. 없으면 빈 컨텍스트, 깨져 있으면 경로를 담은 오류. */
async function readData(dataPath: string): Promise<Record<string, unknown>> {
  let raw: string
  try {
    raw = await readFile(dataPath, 'utf-8')
  } catch {
    // 없는 것은 정상이다 — 플랫폼이 실데이터를 넣으므로 샘플이 없을 수 있다.
    return {}
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    // 배열·원시값이면 컨텍스트로 쓸 수 없다. 최상위는 객체여야 한다.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('최상위가 객체({ ... })가 아닙니다')
    }
    return parsed as Record<string, unknown>
  } catch (err) {
    throw new LiquidPreviewError(`data.json 파싱 실패: ${(err as Error).message}`, dataPath)
  }
}

/**
 * `public/{type}/{name}/template.liquid`를 같은 폴더의 `data.json`으로 렌더한다.
 *
 * `name`은 `events/summer`처럼 중첩을 허용한다 — 빌더는 깊이 1만 인정하지만, 규약을 어긴 파일도
 * 화면에 보여 줘야 무엇이 잘못됐는지 알 수 있기 때문이다(경고는 호출자가 붙인다).
 */
export async function renderTemplate(
  engine: Liquid,
  root: string,
  type: LiquidSurface,
  name: string,
): Promise<RenderResult> {
  const dir = join(root, 'public', type, name)
  const templatePath = join(dir, 'template.liquid')

  let source: string
  try {
    source = await readFile(templatePath, 'utf-8')
  } catch {
    throw new LiquidPreviewError('template.liquid를 찾을 수 없습니다', templatePath)
  }

  const data = await readData(join(dir, 'data.json'))

  try {
    const html = await engine.parseAndRender(source, data)
    return { html }
  } catch (err) {
    throw new LiquidPreviewError((err as Error).message, templatePath, lineOf(err))
  }
}
