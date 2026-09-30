import { ExitCode, fail } from './output.js'
import type { Build, Placement, Surface } from './types.js'

/** 빌드 산출물 항목 하나. 포털 `buildArtifactView`의 이름·종류. */
export type BuildArtifact = NonNullable<Build['artifacts']>[number]

/**
 * 페이지 경로 입력을 검증·정규화한다. 포털 `normalizePlacementPath`와 같은 규칙이다 —
 * 서버도 다시 검증하지만, 빌드를 만들기 전에 오타를 끊어 기다린 끝에 400을 보지 않게 한다.
 *
 * - "/"로 시작 · 공백·백슬래시 금지 · 동적 세그먼트(`:` `[` `]`) 금지
 * - 빈 세그먼트·`.`·`..` 금지 · 후행 슬래시는 뗀다("/" 단독은 홈 배치로 그대로 둔다)
 *
 * 정규식을 쓰지 않는다 — 입력 길이에 선형인 문자열 연산만으로 끝낸다.
 */
export function normalizePagePath(raw: string): string {
  const bad = (why: string): never =>
    fail(ExitCode.PRECONDITION, `--path 값이 올바르지 않습니다 (${raw}): ${why}`)
  if (!raw.startsWith('/')) bad('"/"로 시작해야 합니다')
  if ([' ', '\t', '\n', '\r', '\\'].some((c) => raw.includes(c))) {
    bad('공백이나 백슬래시를 쓸 수 없습니다')
  }
  if ([':', '[', ']'].some((c) => raw.includes(c))) bad('동적 세그먼트(:, [, ])를 쓸 수 없습니다')
  if (raw === '/') return '/'
  const trimmed = trimTrailingSlashes(raw)
  if (trimmed === '') bad('빈 세그먼트를 쓸 수 없습니다')
  for (const seg of trimmed.split('/').slice(1)) {
    if (seg === '') bad('빈 세그먼트를 쓸 수 없습니다')
    if (seg === '.' || seg === '..') bad('"."·".." 세그먼트를 쓸 수 없습니다')
  }
  return trimmed
}

function trimTrailingSlashes(s: string): string {
  let end = s.length
  while (end > 0 && s[end - 1] === '/') end--
  return s.slice(0, end)
}

/** 위젯(슬롯) 산출물 — 디렉터리 이름이 슬롯 id의 콜론을 `--`로 바꾼 모양이다. */
function isSlotArtifact(a: BuildArtifact): boolean {
  return a.name.includes('--')
}

/**
 * 이 surface에 PAGE로 걸 수 있는 산출물. 위젯 산출물과 다른 surface의 liquid 항목
 * (`admin/...`을 USER에)은 뺀다 — 포털이 둘 다 400으로 막는다.
 */
function pageArtifacts(build: Build, surface: Surface): BuildArtifact[] {
  const prefix = surface.toLowerCase() + '/'
  return (build.artifacts ?? []).filter((a) => {
    if (isSlotArtifact(a)) return false
    return a.kind !== 'liquid' || a.name.startsWith(prefix)
  })
}

/** 사람이 `--template`에 쓰는 이름 — liquid는 surface 접두사를 뗀다. */
function displayName(a: BuildArtifact): string {
  return a.kind === 'liquid' ? a.name.slice(a.name.indexOf('/') + 1) : a.name
}

/** 에러 안내용 — `--template`에 쓸 수 있는 이름 목록. */
export function pageArtifactNames(build: Build, surface: Surface): string[] {
  return pageArtifacts(build, surface).map(displayName)
}

/**
 * `--template` 값을 빌드 산출물 항목으로 푼다. sdk는 이름 그대로(`todos`), liquid는
 * `hello`와 `user/hello` 둘 다 받는다. 못 찾으면 undefined.
 */
export function resolvePageArtifact(
  build: Build,
  template: string,
  surface: Surface,
): BuildArtifact | undefined {
  const candidates = pageArtifacts(build, surface)
  return (
    candidates.find((a) => a.name === template) ??
    candidates.find((a) => a.kind === 'liquid' && displayName(a) === template)
  )
}

/** `--path`가 없을 때 포털이 파생하는 경로 — sdk는 `/{이름}`, liquid는 `/{surface 뒤 이름}`. */
export function derivedPagePath(a: BuildArtifact): string {
  return '/' + displayName(a)
}

/** 이 경로를 이미 쓰고 있는 PAGE 배치(같은 surface 목록 안에서). */
export function findPathOwner(placements: Placement[], path: string): Placement | undefined {
  return placements.find((p) => p.kind === 'PAGE' && p.path !== undefined && samePath(p.path, path))
}

function samePath(a: string, b: string): boolean {
  const norm = (s: string) => (s === '/' ? s : trimTrailingSlashes(s) || '/')
  return norm(a) === norm(b)
}
