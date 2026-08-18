#!/usr/bin/env node
/**
 * 슬롯 배치 도식 생성기 — `docs/assets/slots/*.svg`
 *
 * 페이지의 세로 구성을 실제 화면 비율대로 그리고 슬롯 자리만 강조한다.
 * 수치는 실제 플랫폼 화면(1440×900 뷰포트)을 실측한 값이다.
 * 화면 캡처를 그대로 싣지 않는 이유: 운영 스페이스라 개인 사진·제3자 저작물이 섞인다.
 * 도식은 배치 정보만 남기므로 그대로 실을 수 있고, 텍스트라 diff·검색도 된다.
 *
 *   node scripts/gen-slot-figures.mjs          # 생성
 *   node scripts/gen-slot-figures.mjs --check  # 생성물이 최신인지 검사
 *
 * 플랫폼 페이지 구성이 바뀌면 아래 PAGES의 수치를 고치고 다시 돌린다.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'docs/assets/slots')

// 실측은 1440px 뷰포트 기준. 문서에는 절반으로 줄여 얹는다.
const S = 0.5
const VIEWPORT = 1440
const W = VIEWPORT * S
const p = (v) => +(v * S).toFixed(1)

/** 가로 영역 [x, width] — 실측 px */
const AREA = {
  full: [4, 1432], // 화면 전체 폭
  wide: [175, 1082], // 히어로·캐러셀
  content: [208, 1016], // 일반 콘텐츠 컨테이너
  narrow: [396, 640], // 상세 페이지 본문 컬럼
  detail: [366, 702], // 상세 페이지에서 본문보다 넓게 깔리는 자리
}
const areaOf = (b, fallback) => (Array.isArray(b.area) ? b.area : AREA[b.area ?? fallback])

// 색은 플랫폼 UI와 probe 오버레이에서 가져왔다. 두 GitHub 테마에서 같게 보인다.
const C = {
  page: '#16191E',
  chrome: '#22272F',
  sunken: '#1A1E24',
  block: '#2A3038',
  blockAlt: '#333B45',
  line: '#39414C',
  lineStrong: '#5A6472',
  slotFill: '#1E2536',
  slotEdge: '#F0A030',
  slotText: '#EDF1F6',
  ctx: '#7FB3D5',
  muted: '#616D7D',
  note: '#4E5867',
}
const SANS = "ui-sans-serif, -apple-system, 'Segoe UI', Roboto, sans-serif"
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const rect = (x, y, w, h, fill, r = 4) =>
  `<rect x="${p(x)}" y="${p(y)}" width="${p(w)}" height="${p(h)}" rx="${r}" fill="${fill}"/>`
const bar = (x, y, w, h, fill) => rect(x, y, w, h, fill, Math.min(3, p(h) / 2))
const circle = (cx, cy, r, fill) =>
  `<circle cx="${p(cx)}" cy="${p(cy)}" r="${p(r)}" fill="${fill}"/>`
const line = (x1, y1, x2, y2, stroke = C.block) =>
  `<line x1="${p(x1)}" y1="${p(y1)}" x2="${p(x2)}" y2="${p(y2)}" stroke="${stroke}" stroke-width="1"/>`
const text = (x, y, s, { fill = C.muted, size = 9, font = SANS, anchor, weight, ls } = {}) =>
  `<text x="${p(x)}" y="${p(y)}" fill="${fill}" font-family="${font}" font-size="${size}"` +
  `${anchor ? ` text-anchor="${anchor}"` : ''}${weight ? ` font-weight="${weight}"` : ''}` +
  `${ls ? ` letter-spacing="${ls}"` : ''}>${esc(s)}</text>`
/** 오른쪽 여백의 영역 이름 */
const tag = (y, s) =>
  s ? [text(VIEWPORT - 16, y, s, { fill: C.note, size: 9, anchor: 'end' })] : []

// ── 블록 렌더러 — 각자 [y, y+b.h] 안에 그린다 ─────────────────────────────
const BLOCKS = {
  gnb(b, y) {
    const out = [rect(0, y, VIEWPORT, b.h, C.chrome, 0)]
    const cy = y + b.h / 2
    if (b.wordmark) out.push(bar(424, cy - 9, 118, 18, C.lineStrong))
    else out.push(circle(448, cy, 16, C.line))
    let x = b.wordmark ? 690 : 596
    ;(b.nav ?? [52, 44, 36, 84, 48, 72]).forEach((w, i) => {
      out.push(bar(x, cy - 6, w, 12, i === b.active ? C.lineStrong : C.line))
      x += w + 20
    })
    const icons = b.icons ?? 5
    for (let i = 0; i < icons; i++) out.push(circle(2024 / 2 + i * 48, cy, 12, C.line))
    return out
  },

  /** 슬롯 자리 — 이 도식의 주인공 */
  slot(b, y) {
    const [ax, aw] = areaOf(b, 'full')
    const ctx = b.ctx ?? 'context 없음'
    // 모노스페이스 기준 폭 추정(실측 px). 한 줄에 안 들어가면 context를 키 아래로 내린다 —
    // 컬럼 안에 들어가는 자리(커뮤니티 보드·라운지)가 여기 걸린다.
    const keyW = b.key.length * 15
    const ctxW = ctx.length * (b.ctx ? 12.6 : 13)
    const stacked = keyW + ctxW + 96 > aw
    const ctxStyle = b.ctx
      ? { fill: C.ctx, size: 10.5, font: MONO }
      : { fill: C.muted, size: 10, font: SANS }

    return [
      `<rect x="${p(ax)}" y="${p(y)}" width="${p(aw)}" height="${p(b.h)}" rx="4" fill="${C.slotFill}" stroke="${C.slotEdge}" stroke-width="1.6"/>`,
      text(ax + 24, y + (stacked ? 32 : 40), '▾ V2 SLOT', {
        fill: C.slotEdge,
        size: 8,
        weight: 700,
        ls: 1.1,
      }),
      text(ax + 24, y + (stacked ? 66 : 80), b.key, { fill: C.slotText, size: 12.5, font: MONO }),
      stacked
        ? text(ax + 24, y + 94, ctx, ctxStyle)
        : text(ax + aw - 24, y + 80, ctx, { ...ctxStyle, anchor: 'end' }),
    ]
  },

  /** 큰 이미지 (히어로·배너·본문 이미지·영상) */
  media(b, y) {
    const [ax, aw] = areaOf(b, 'wide')
    const out = []
    const cols = b.cols ?? 1
    const gap = 26
    const cw = (aw - gap * (cols - 1)) / cols
    for (let i = 0; i < cols; i++) {
      out.push(rect(ax + i * (cw + gap), y, cw, b.h, C.block, b.area === 'full' ? 0 : 4))
    }
    if (b.inner) out.push(rect(ax + (aw - b.inner) / 2, y, b.inner, b.h, C.blockAlt, 0))
    if (b.thumbs) {
      for (let i = 0; i < b.thumbs; i++) {
        const on = i === b.thumbs - 1
        out.push(rect(ax + 48 + i * 108, y + b.h - 88, 92, 60, on ? C.blockAlt : C.line))
      }
    }
    if (b.play) out.push(circle(ax + aw / 2, y + b.h / 2, 26, C.blockAlt))
    return [...out, ...tag(y + b.h / 2, b.label)]
  },

  /** 제목 + 카드 한 줄 + 카드 라벨 */
  cards(b, y) {
    const [ax, aw] = areaOf(b, 'content')
    const n = b.n ?? 4
    const gap = b.gap2 ?? 24
    const cw = (aw - gap * (n - 1)) / n
    const out = []
    let cy = y
    if (b.heading !== false) {
      out.push(bar(ax, cy, b.headingW ?? 172, 18, C.lineStrong))
      if (b.viewAll !== false) out.push(bar(ax + aw - 56, cy + 3, 56, 12, C.line))
      cy += 40
    }
    for (let i = 0; i < n; i++) out.push(rect(ax + i * (cw + gap), cy, cw, b.cardH, C.block))
    cy += b.cardH + 18
    ;(b.labels ?? [104, 80, 132, 68, 96, 112]).slice(0, n).forEach((lw, i) => {
      out.push(bar(ax + i * (cw + gap), cy, Math.min(lw, cw), 12, C.line))
    })
    if (b.sub) {
      cy += 22
      ;(b.labels ?? [104, 80, 132, 68]).slice(0, n).forEach((_, i) => {
        out.push(bar(ax + i * (cw + gap), cy, 72, 10, C.line))
      })
    }
    return [...out, ...tag(y + b.h / 2, b.label)]
  },

  /** 동그란 카테고리 아이콘 줄 */
  circles(b, y) {
    const [ax, aw] = areaOf(b, 'content')
    const n = b.n ?? 10
    const step = aw / n
    const out = []
    for (let i = 0; i < n; i++) {
      out.push(circle(ax + step * (i + 0.5), y + 50, 44, C.block))
      out.push(bar(ax + step * (i + 0.5) - 34, y + 110, 68, 10, C.line))
    }
    return [...out, ...tag(y + b.h / 2, b.label)]
  },

  /** 태그·필터 pill 줄 */
  pills(b, y) {
    const [ax] = areaOf(b, 'content')
    const out = []
    let x = ax
    if (b.leadIcon !== false) {
      out.push(circle(ax + 10, y + b.h / 2, 10, C.line))
      x += 36
    }
    for (const w of b.widths ?? [72, 84, 68, 52, 52, 52, 52, 60]) {
      out.push(rect(x, y + b.h / 2 - 18, w, 36, C.block, 18))
      x += w + 12
    }
    return [...out, ...tag(y + b.h / 2, b.label)]
  },

  /** 왼쪽 목록 + 오른쪽 컬럼. 오른쪽에 자식 블록을 쌓는다 (슬롯이 컬럼 안에 있는 페이지) */
  rail(b, y) {
    const [ax, aw] = areaOf(b, 'content')
    const lw = b.leftW ?? 346
    const out = []
    for (let i = 0; i < (b.rows ?? 6); i++) {
      const ry = y + 20 + i * 42
      if (i === 0) out.push(rect(ax, ry - 12, lw, 40, C.chrome))
      out.push(circle(ax + 22, ry + 8, 9, C.line))
      out.push(bar(ax + 44, ry + 2, 116 + ((i * 53) % 96), 12, i === 0 ? C.lineStrong : C.line))
    }
    const right = [ax + lw + 58, aw - lw - 58]
    let cy = y
    for (const c of b.blocks) {
      cy += c.gap ?? 0
      out.push(...BLOCKS[c.type]({ ...c, area: c.area ?? right }, cy))
      cy += c.h
    }
    return [...out, ...tag(y + 20, b.label)]
  },

  /** 아바타 + 이름 + 시각 */
  avatarRow(b, y) {
    const [ax] = areaOf(b, 'narrow')
    return [
      circle(ax + 20, y + 24, 18, C.line),
      bar(ax + 52, y + 10, 68, 12, C.lineStrong),
      bar(ax + 52, y + 32, 124, 10, C.line),
      ...tag(y + 24, b.label),
    ]
  },

  /** 작성자 + 제목 + 본문 + 리액션 */
  post(b, y) {
    const [ax] = areaOf(b, 'narrow')
    return [
      circle(ax + 20, y + 26, 18, C.line),
      bar(ax + 52, y + 12, 68, 12, C.lineStrong),
      bar(ax + 52, y + 34, 124, 10, C.line),
      bar(ax, y + 84, b.titleW ?? 92, 16, C.lineStrong),
      bar(ax, y + 124, b.bodyW ?? 72, 12, C.line),
      rect(ax, y + 158, 40, 28, C.block, 14),
      ...tag(y + b.h / 2, b.label),
    ]
  },

  /** 작은 리액션 pill 하나 */
  pill(b, y) {
    const [ax] = areaOf(b, 'narrow')
    return [rect(ax, y, 40, b.h, C.block, 14), ...tag(y + b.h / 2, b.label)]
  },

  /** 댓글 섹션 (배경이 한 단 가라앉는다) */
  comments(b, y) {
    const [ax, aw] = areaOf(b, 'narrow')
    return [
      rect(0, y, VIEWPORT, b.h, C.sunken, 0),
      bar(ax, y + 34, 88, 14, C.lineStrong),
      rect(ax, y + 70, aw, 48, C.chrome),
      circle(VIEWPORT / 2, y + b.h - 56, 16, C.block),
      bar(VIEWPORT / 2 - 84, y + b.h - 26, 168, 12, C.line),
      ...tag(y + 44, b.label),
    ]
  },

  /** 아바타 + 이름 + 버튼이 반복되는 목록 */
  list(b, y) {
    const [ax, aw] = areaOf(b, 'narrow')
    const out = []
    for (let i = 0; i < (b.rows ?? 5); i++) {
      const ry = y + i * (b.rowH ?? 64)
      out.push(circle(ax + 20, ry + 22, 18, C.line))
      out.push(bar(ax + 52, ry + 16, 120 + ((i * 41) % 72), 12, C.lineStrong))
      if (b.button !== false) out.push(rect(ax + aw - 92, ry + 8, 92, 28, C.block))
    }
    return [...out, ...tag(y + 20, b.label)]
  },

  /** 줄글 묶음 (푸터) */
  lines(b, y) {
    const [ax, aw] = areaOf(b, 'content')
    const out = []
    const ws = b.widths ?? [184, 160, 208, 140, 192, 116, 220]
    ws.forEach((w, i) => out.push(bar(ax, y + 24 + i * 24, w, 12, C.line)))
    if (b.rule) {
      const ry = y + 24 + ws.length * 24 + 30
      out.push(line(ax - 24, ry, ax + aw + 24, ry))
      let lx = VIEWPORT / 2 - 244
      for (const [i, w] of [88, 192, 44, 68].entries()) {
        out.push(bar(lx, ry + 28, w, 12, i === 0 ? C.note : C.line))
        lx += w + 20
      }
    }
    return [...out, ...tag(y + b.h / 2, b.label)]
  },

  /** 이름만 있는 얇은 줄 (제목·보드 이름·캡션) */
  strip(b, y) {
    const [ax] = areaOf(b, 'narrow')
    const h = b.barH ?? 14
    return [
      bar(ax, y + (b.h - h) / 2, b.w ?? 144, h, b.strong ? C.lineStrong : C.line),
      ...tag(y + b.h / 2, b.label),
    ]
  },

  /** 라운지 상단 배너 */
  loungeHero(b, y) {
    const [ax] = AREA.content
    return [
      rect(0, y, VIEWPORT, b.h, b.tone ?? '#7A7420', 0),
      bar(ax, y + 44, 268, 34, 'rgba(0,0,0,.30)'),
      bar(ax, y + 100, 396, 14, 'rgba(0,0,0,.20)'),
      rect(ax, y + 134, 84, 36, 'rgba(0,0,0,.22)', 4),
      ...tag(y + b.h / 2, b.label ?? '라운지 헤더'),
    ]
  },

  /** 탭 줄 */
  tabs(b, y) {
    const [ax, aw] = AREA.content
    const out = [rect(0, y, VIEWPORT, b.h, '#1C2026', 0)]
    const n = b.n ?? 3
    const step = aw / n
    for (let i = 0; i < n; i++) {
      const cx = ax + step * i + step / 2
      out.push(bar(cx - 70, y + b.h / 2 - 7, 140, 14, i === b.active ? C.lineStrong : C.line))
      if (i === b.active)
        out.push(rect(ax + step * i + 24, y + b.h - 4, step - 48, 4, C.lineStrong, 0))
    }
    return out
  },

  /** 상품 정보 (이름·가격·배송·설명) */
  product(b, y) {
    const [ax, aw] = AREA.narrow
    return [
      bar(ax, y + 16, 176, 14, C.line),
      bar(ax, y + 48, 108, 24, C.lineStrong),
      bar(ax, y + 106, 96, 10, C.line),
      bar(ax + 240, y + 106, 40, 10, C.line),
      bar(ax, y + 140, 96, 10, C.line),
      bar(ax + 240, y + 140, 68, 10, C.line),
      bar(ax + 240, y + 162, 68, 10, C.line),
      rect(ax + 240, y + 186, 216, 24, C.block),
      bar(ax, y + 232, 152, 10, C.line),
      line(ax - 32, y + 278, ax + aw + 32, y + 278),
      bar(ax, y + 302, 92, 16, C.lineStrong),
      bar(ax, y + 348, 40, 10, C.line),
      ...tag(y + b.h / 2, b.label),
    ]
  },

  /** 로그인 유도 카드 */
  loginCard(b, y) {
    const [ax, aw] = areaOf(b, 'narrow')
    return [
      rect(ax, y, aw, b.h, C.chrome),
      circle(ax + 48, y + b.h / 2, 28, C.block),
      bar(ax + 92, y + b.h / 2 - 7, 68, 14, C.lineStrong),
      ...tag(y + b.h / 2, b.label),
    ]
  },

  /** 아이콘 + 라벨 메뉴 목록 */
  menu(b, y) {
    const [ax, aw] = areaOf(b, 'narrow')
    const out = []
    let cy = y
    b.groups.forEach((g, gi) => {
      for (const w of g) {
        out.push(circle(ax + 16, cy + 26, 13, C.line))
        out.push(bar(ax + 48, cy + 19, w, 14, C.lineStrong))
        cy += 52
      }
      if (gi < b.groups.length - 1) {
        out.push(line(ax, cy + 8, ax + aw, cy + 8))
        cy += 24
      }
    })
    return [...out, ...tag(y + 30, b.label)]
  },

  /** "View All" 같은 넓은 버튼 */
  button(b, y) {
    const [ax, aw] = areaOf(b, 'content')
    return [
      `<rect x="${p(ax)}" y="${p(y)}" width="${p(aw)}" height="${p(b.h)}" rx="4" fill="none" stroke="${C.line}" stroke-width="1"/>`,
      bar(VIEWPORT / 2 - 60, y + b.h / 2 - 6, 120, 12, C.line),
    ]
  },
}

// ── 조립 ──────────────────────────────────────────────────────────────────
/** 잘린 경계 표시 — 선과 라벨이 내용과 겹치지 않도록 자리를 따로 잡는다 */
const cutMark = (lineY, textY) =>
  `<line x1="0" y1="${p(lineY)}" x2="${W}" y2="${p(lineY)}" stroke="${C.note}" stroke-width="1" stroke-dasharray="6 5"/>` +
  `\n  <text x="${W / 2}" y="${p(textY)}" fill="${C.note}" font-family="${SANS}" font-size="9" text-anchor="middle">페이지 이어짐</text>`

function render(page) {
  const parts = []
  let y = 0
  if (page.cutTop) {
    parts.push(cutMark(26, 52))
    y = 72
  }
  const top = y
  for (const b of page.blocks) {
    y += b.gap ?? 0
    const fn = BLOCKS[b.type]
    if (!fn) throw new Error(`${page.id}: 모르는 블록 "${b.type}"`)
    parts.push(...fn(b, y))
    y += b.h
  }
  const realH = y - top
  if (page.cutBottom) {
    y += 34
    parts.push(cutMark(y, y + 26))
    y += 34
  }
  const H = y + 52

  const head = [
    rect(0, 0, VIEWPORT, H, C.page, 0),
    text(16, H - 20, page.note ?? 'PC · 모바일 섹션 순서 동일', { fill: C.note, size: 10 }),
    text(
      VIEWPORT - 16,
      H - 20,
      `${VIEWPORT} × ${page.cutTop || page.cutBottom ? '표시 구간 ' : '약 '}${Math.round(realH).toLocaleString('en-US')}px · 50% 축소`,
      { fill: C.note, size: 10, anchor: 'end' },
    ),
  ]

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${p(H)}" width="${W}" height="${p(H)}" role="img" aria-label="${esc(page.title)} 페이지의 섹션 구성과 슬롯 자리">\n` +
    `  <title>${esc(page.title)} — 슬롯 배치</title>\n  ` +
    [...head, ...parts].join('\n  ') +
    `\n</svg>\n`
  )
}

// ── 페이지 정의 (실측값, 1440px 뷰포트 기준) ──────────────────────────────
const FOOTER = { type: 'lines', h: 340, rule: true, label: '푸터', gap: 40 }
const GNB = (active, extra = {}) => ({ type: 'gnb', h: 72, active, ...extra })

const PAGES = [
  {
    id: 'contents-home',
    title: '콘텐츠 홈',
    blocks: [
      GNB(5),
      { type: 'media', h: 310, area: 'wide', thumbs: 3, label: '큐레이션 캐러셀' },
      { type: 'slot', h: 110, gap: 16, key: 'user.contents-home.curation:after' },
      { type: 'pills', h: 70, gap: 20, label: '태그' },
      {
        type: 'cards',
        h: 300,
        gap: 48,
        cardH: 230,
        headingW: 144,
        viewAll: false,
        label: '라이브',
      },
      { type: 'slot', h: 110, gap: 48, key: 'user.contents-home.contents-section:before' },
      { type: 'cards', h: 200, gap: 40, cardH: 135, headingW: 172, label: '섹션 묶음' },
      { type: 'cards', h: 200, gap: 32, cardH: 135, headingW: 188 },
      { type: 'media', h: 170, gap: 40, area: 'full', inner: 328 },
      { type: 'slot', h: 110, gap: 40, key: 'user.contents-home.contents-section:after' },
      FOOTER,
    ],
  },
  {
    id: 'contents-detail',
    title: '콘텐츠 상세',
    blocks: [
      GNB(5),
      { type: 'strip', h: 34, gap: 24, w: 326, barH: 22, strong: true, label: '제목' },
      { type: 'strip', h: 14, gap: 16, w: 64 },
      {
        type: 'slot',
        h: 112,
        gap: 48,
        key: 'user.contents-detail.body:before',
        ctx: 'content: Content',
      },
      { type: 'strip', h: 18, gap: 22, w: 168 },
      { type: 'media', h: 640, gap: 8, area: 'narrow', label: '본문' },
      {
        type: 'slot',
        h: 110,
        gap: 20,
        key: 'user.contents-detail.body:after',
        ctx: 'content: Content',
      },
      { type: 'pill', h: 30, gap: 40 },
      {
        type: 'slot',
        h: 110,
        gap: 100,
        key: 'user.contents-detail.comments:before',
        ctx: 'content: Content',
      },
      { type: 'comments', h: 210, gap: 18, label: '댓글' },
    ],
  },
  {
    id: 'contents-curation',
    title: '콘텐츠 큐레이션 목록',
    cutBottom: true,
    blocks: [
      GNB(5),
      { type: 'slot', h: 110, gap: 48, area: 'content', key: 'user.contents-curation.list:before' },
      {
        type: 'strip',
        h: 36,
        gap: 65,
        area: 'content',
        w: 138,
        barH: 24,
        strong: true,
        label: '큐레이션 제목',
      },
      { type: 'strip', h: 14, gap: 12, area: 'content', w: 64 },
      { type: 'cards', h: 211, gap: 28, n: 3, cardH: 183, heading: false, sub: true },
    ],
  },
  {
    id: 'contents-section',
    title: '콘텐츠 섹션 목록',
    cutBottom: true,
    blocks: [
      GNB(5),
      {
        type: 'slot',
        h: 110,
        gap: 48,
        area: 'content',
        key: 'user.contents-section.list:before',
        ctx: 'section: Section',
      },
      {
        type: 'strip',
        h: 36,
        gap: 68,
        area: 'content',
        w: 196,
        barH: 24,
        strong: true,
        label: '섹션 제목',
      },
      { type: 'strip', h: 14, gap: 12, area: 'content', w: 64 },
      { type: 'cards', h: 233, gap: 32, n: 3, cardH: 183, heading: false, sub: true },
      { type: 'cards', h: 233, gap: 24, n: 3, cardH: 183, heading: false, sub: true },
    ],
  },
  {
    id: 'story-home',
    title: '스토리 홈',
    cutBottom: true,
    blocks: [
      GNB(1),
      { type: 'slot', h: 110, gap: 16, key: 'user.story-home.feed:before' },
      {
        type: 'rail',
        h: 660,
        gap: 24,
        rows: 12,
        label: '작성자 목록 · 피드',
        blocks: [
          { type: 'avatarRow', h: 60 },
          { type: 'media', h: 580, gap: 22 },
        ],
      },
    ],
  },
  {
    id: 'story-feed-detail',
    title: '스토리 피드 상세',
    blocks: [
      GNB(1),
      {
        type: 'slot',
        h: 110,
        gap: 16,
        key: 'user.story-feed-detail.post:before',
        ctx: 'content: Content',
      },
      { type: 'avatarRow', h: 60, gap: 52, label: '포스트' },
      { type: 'media', h: 358, gap: 22, area: 'narrow', inner: 360, play: true },
      { type: 'pill', h: 30, gap: 20 },
      {
        type: 'slot',
        h: 110,
        gap: 56,
        key: 'user.story-feed-detail.comments:before',
        ctx: 'content: Content',
      },
      { type: 'comments', h: 220, gap: 25, label: '댓글' },
    ],
  },
  {
    id: 'pop-home',
    title: 'POP 홈',
    cutTop: true,
    cutBottom: true,
    blocks: [
      { type: 'media', h: 290, area: 'narrow', label: '구독 히어로' },
      { type: 'slot', h: 115, gap: 30, area: 'detail', key: 'user.pop-home.list:before' },
      { type: 'strip', h: 18, gap: 33, w: 132, strong: true },
      { type: 'list', h: 320, gap: 22, rows: 5, label: '구독 목록' },
    ],
  },
  {
    id: 'community-board',
    title: '커뮤니티 게시판',
    cutBottom: true,
    blocks: [
      GNB(3),
      {
        type: 'rail',
        h: 720,
        gap: 32,
        rows: 14,
        label: '보드 목록 · 피드',
        blocks: [
          {
            type: 'slot',
            h: 112,
            key: 'user.community-board.feed:before',
            ctx: 'board: BoardInfo',
          },
          { type: 'strip', h: 30, gap: 15, w: 200, strong: true },
          { type: 'strip', h: 34, gap: 17, w: 92 },
          { type: 'post', h: 196, gap: 33 },
          { type: 'post', h: 196, gap: 29 },
        ],
      },
    ],
  },
  {
    id: 'community-post-detail',
    title: '커뮤니티 포스트 상세',
    blocks: [
      GNB(3),
      { type: 'strip', h: 16, gap: 41, w: 144, strong: true, label: '보드 이름' },
      {
        type: 'slot',
        h: 113,
        gap: 16,
        key: 'user.community-post-detail.post:before',
        ctx: 'post: BoardPostInfo',
      },
      { type: 'post', h: 190, gap: 27, titleW: 68, label: '포스트 본문' },
      {
        type: 'slot',
        h: 115,
        gap: 60,
        key: 'user.community-post-detail.comments:before',
        ctx: 'post: BoardPostInfo',
      },
      { type: 'comments', h: 240, gap: 22, label: '댓글' },
    ],
  },
  {
    id: 'lounge-community',
    title: '라운지 커뮤니티',
    cutBottom: true,
    blocks: [
      GNB(null, { wordmark: true, nav: [40, 76, 44, 56, 52], icons: 3 }),
      { type: 'loungeHero', h: 214 },
      { type: 'tabs', h: 52, active: 2 },
      {
        type: 'rail',
        h: 400,
        gap: 50,
        rows: 4,
        label: '보드 목록 · 피드',
        blocks: [
          {
            type: 'slot',
            h: 120,
            key: 'user.lounge-community.feed:before',
            ctx: 'board: BoardInfo',
          },
          { type: 'strip', h: 28, gap: 24, w: 200, strong: true },
          { type: 'strip', h: 24, gap: 20, w: 92 },
          { type: 'list', h: 156, gap: 28, rows: 3, rowH: 52, button: false },
        ],
      },
    ],
  },
  {
    id: 'lounge-contents',
    title: '라운지 콘텐츠',
    cutBottom: true,
    blocks: [
      GNB(null, { wordmark: true, nav: [40, 76, 44, 56, 52], icons: 3 }),
      { type: 'loungeHero', h: 258 },
      { type: 'tabs', h: 52, active: 1 },
      { type: 'slot', h: 110, gap: 14, key: 'user.lounge-contents.section:before' },
      { type: 'cards', h: 206, gap: 37, n: 4, cardH: 134, headingW: 92, label: '섹션' },
    ],
  },
  {
    id: 'lounge-story',
    title: '라운지 스토리',
    cutBottom: true,
    blocks: [
      GNB(null, { wordmark: true, nav: [40, 76, 44, 56, 52], icons: 3 }),
      { type: 'loungeHero', h: 258 },
      { type: 'tabs', h: 52, active: 0 },
      { type: 'slot', h: 110, gap: 14, key: 'user.lounge-story.feed:before' },
      {
        type: 'rail',
        h: 300,
        gap: 30,
        rows: 2,
        label: '작성자 목록 · 피드',
        blocks: [
          { type: 'avatarRow', h: 60 },
          { type: 'lines', h: 150, gap: 20, widths: [72, 118, 168], rule: false },
        ],
      },
    ],
  },
  {
    id: 'my-home',
    title: '마이 홈',
    blocks: [
      GNB(null),
      { type: 'loginCard', h: 92, gap: 46, area: 'detail', label: '로그인' },
      { type: 'slot', h: 113, gap: 12, area: 'detail', key: 'user.my-home.menu:before' },
      {
        type: 'menu',
        h: 412,
        gap: 32,
        area: 'detail',
        label: '메뉴',
        groups: [[168], [92, 84], [132, 156, 64, 64]],
      },
    ],
  },
  {
    id: 'shop-home',
    title: '샵 홈',
    cutBottom: true,
    blocks: [
      GNB(4),
      { type: 'slot', h: 110, gap: 16, key: 'user.shop-home.section:before' },
      { type: 'media', h: 126, gap: 14, area: 'content', cols: 2, label: '배너' },
      { type: 'circles', h: 130, gap: 66, n: 10, label: '카테고리' },
      { type: 'button', h: 46, gap: 46 },
      { type: 'cards', h: 336, gap: 88, cardH: 236, headingW: 152, sub: true, label: '상품 목록' },
      { type: 'strip', h: 18, gap: 30, area: 'content', w: 148 },
      { type: 'slot', h: 110, gap: 34, key: 'user.shop-home.section:after' },
      FOOTER,
    ],
  },
  {
    id: 'product-detail',
    title: '상품 상세',
    cutTop: true,
    cutBottom: true,
    blocks: [
      { type: 'media', h: 210, area: 'narrow', label: '상품 이미지' },
      { type: 'product', h: 380, gap: 78, label: '상품 정보' },
      {
        type: 'slot',
        h: 112,
        gap: 110,
        area: 'detail',
        key: 'user.product-detail.detail:after',
        ctx: 'product: Product',
      },
    ],
  },
]

// ── 실행 ──────────────────────────────────────────────────────────────────
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

const check = process.argv.includes('--check')
let stale = 0

for (const page of PAGES) {
  const svg = render(page)
  const file = join(OUT_DIR, `${page.id}.svg`)
  if (check) {
    const cur = existsSync(file) ? readFileSync(file, 'utf-8') : ''
    if (cur !== svg) {
      console.error(`  ✗ ${page.id}.svg — 생성물이 낡았습니다`)
      stale++
    }
  } else {
    writeFileSync(file, svg)
    console.log(`  ✓ ${page.id}.svg`)
  }
}

if (check) {
  if (stale > 0) {
    console.error(`\n${stale}개가 낡았습니다. \`node scripts/gen-slot-figures.mjs\`를 돌리세요.`)
    process.exit(1)
  }
  console.log(`슬롯 도식 ${PAGES.length}개 최신입니다.`)
} else {
  console.log(`\n슬롯 도식 ${PAGES.length}개 생성.`)
}
