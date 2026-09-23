import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LiquidError } from 'liquidjs'
import { detectProjectKind } from '../project/detectKind.js'
import { createEngine } from './render.js'

/** 검증 결과 한 건. `path`는 root 기준 posix 상대 경로다(정렬 키이자 사용자에게 보여줄 위치). */
export interface LiquidIssue {
  level: 'error' | 'warn'
  path: string
  message: string
}

/** 포털 빌더가 패키징 대상으로 인정하는 surface. `detectProjectKind`와 같은 규칙이다. */
const SURFACES = ['admin', 'user'] as const

/**
 * 템플릿 폴더 이름 규칙. CDN 경로 세그먼트가 되므로 소문자·숫자·하이픈만 쓴다.
 * 대문자는 대소문자를 구분하지 않는 파일시스템(macOS)에서 로컬과 배포가 갈린다.
 */
const FOLDER_NAME_RE = /^[a-z][a-z0-9-]*$/

/** 포털이 패키징에서 지우는 파일. 배치(관리도구)가 소유하므로 레포에 둬도 배포에 나가지 않는다. */
const STRIPPED_FILES = ['data.json', 'layout.json']

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

/** liquidjs가 메시지 끝에 붙이는 `, file:…, line:…, col:…`을 떼어낸다(줄 번호는 따로 붙인다). */
function trimLocation(message: string): string {
  return message.replace(/,\s*(?:file:[^,]*,\s*)?line:\d+,\s*col:\d+\s*$/, '')
}

/** 디렉터리의 엔트리 목록. 없거나 읽을 수 없으면 빈 배열 — 검증은 예외를 던지지 않는다. */
function readEntries(dir: string): { name: string; isDirectory: boolean; isFile: boolean }[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).map((d) => ({
      name: d.name,
      isDirectory: d.isDirectory(),
      isFile: d.isFile(),
    }))
  } catch {
    return []
  }
}

/** 파일 내용. 없으면 null. */
function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

/** 템플릿 하나에 대한 문법·데이터 검증. */
function validateTemplate(
  engine: ReturnType<typeof createEngine>,
  root: string,
  id: string,
): LiquidIssue[] {
  const issues: LiquidIssue[] = []
  const dir = `public/${id}`

  try {
    const source = readText(join(root, dir, 'template.liquid'))
    // 파일이 사라졌으면(경합) 검증할 것이 없다 — 판정은 detectProjectKind가 이미 했다.
    if (source !== null) engine.parse(source)
  } catch (err) {
    const line = lineOf(err)
    const detail = trimLocation((err as Error).message)
    issues.push({
      level: 'error',
      path: `${dir}/template.liquid`,
      message: line === undefined ? `liquid 문법 오류: ${detail}` : `${line}번째 줄: ${detail}`,
    })
  }

  const name = id.split('/')[1] ?? ''
  if (!FOLDER_NAME_RE.test(name)) {
    issues.push({
      level: 'error',
      path: dir,
      message: `폴더 이름 "${name}"은 규칙에 맞지 않습니다 — 소문자로 시작하고 소문자·숫자·하이픈만 쓰세요(CDN 경로가 됩니다).`,
    })
  }

  const raw = readText(join(root, dir, 'data.json'))
  if (raw !== null) {
    try {
      JSON.parse(raw)
    } catch (err) {
      issues.push({
        level: 'error',
        path: `${dir}/data.json`,
        message: `JSON 파싱 실패: ${(err as Error).message}`,
      })
    }
  }

  if (readText(join(root, dir, 'layout.json')) !== null) {
    issues.push({
      level: 'warn',
      path: `${dir}/layout.json`,
      message: '배치는 관리도구가 소유합니다 — 포털이 패키징에서 이 파일을 지웁니다.',
    })
  }

  return issues
}

/**
 * `public/{user|admin}/` 바로 아래 폴더 중 `template.liquid`가 없는 것을 찾는다.
 * 이름이 `index.html`처럼 다르면 포털은 그 폴더를 템플릿으로 보지 않는다 — 조용히 빈 자리가 된다.
 */
function findMisnamedTemplates(root: string): LiquidIssue[] {
  const issues: LiquidIssue[] = []
  for (const surface of SURFACES) {
    const surfaceDir = join(root, 'public', surface)
    for (const entry of readEntries(surfaceDir)) {
      if (!entry.isDirectory || entry.name.startsWith('.')) continue
      const files = readEntries(join(surfaceDir, entry.name)).filter((e) => e.isFile)
      if (files.length === 0) continue
      if (files.some((f) => f.name === 'template.liquid')) continue
      if (files.every((f) => STRIPPED_FILES.includes(f.name))) continue
      issues.push({
        level: 'warn',
        path: `public/${surface}/${entry.name}`,
        message: `템플릿 파일 이름은 template.liquid 여야 합니다 — 지금은 ${files
          .map((f) => f.name)
          .join(', ')} 뿐이라 포털이 이 폴더를 무시합니다.`,
      })
    }
  }
  return issues
}

/**
 * liquid 레포를 정적 검증한다. **`root` 아래만 읽는 순수 함수**이고 아무것도 쓰지 않는다.
 *
 * 포털 빌더는 push된 커밋의 `public/{user|admin}/{name}/`을 그대로 복사해 패키징하므로
 * 로컬 빌드 산출물이 없다. 즉 잘못된 문법·이름·위치는 **배포 뒤 화면에서야** 드러난다.
 * 이 함수가 그 자리를 대신한다 — `bstage build`·`bstage doctor`가 같은 결과를 쓴다.
 *
 * 결과는 path 순으로 정렬한다(출력 순서가 실행마다 흔들리지 않게).
 */
export function validateLiquid(root: string): LiquidIssue[] {
  const detected = detectProjectKind(root)
  const issues: LiquidIssue[] = []

  if (detected.kind === 'mixed') {
    issues.push({
      level: 'error',
      path: '.',
      message:
        'sdk 템플릿(src/pages·src/slots의 template.tsx)과 liquid 템플릿이 한 레포에 섞여 있습니다 — ' +
        '포털 빌더는 둘을 함께 패키징하지 못합니다. 하나만 남겨 주세요.',
    })
  }

  if (detected.liquidTemplates.length === 0) {
    issues.push({
      level: 'error',
      path: 'public',
      message:
        'liquid 템플릿이 없습니다 — public/{user|admin}/{이름}/template.liquid 를 만들어 주세요.',
    })
  }

  const engine = createEngine(root)
  for (const id of detected.liquidTemplates) {
    issues.push(...validateTemplate(engine, root, id))
  }

  for (const path of detected.ignoredLiquid) {
    issues.push({
      level: 'warn',
      path,
      message:
        '포털이 무시하는 위치입니다 — 인정되는 자리는 public/{user|admin}/{이름}/template.liquid 뿐입니다.',
    })
  }

  issues.push(...findMisnamedTemplates(root))

  // 입력을 바꾸지 않는다(불변) — 복사 후 정렬. path가 같으면 넣은 순서를 유지한다(안정 정렬).
  return [...issues].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}
