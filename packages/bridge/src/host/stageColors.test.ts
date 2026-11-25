import { describe, expect, it } from 'vitest'
import { isStageColorValue, STAGE_COLOR_VARS } from '../protocol/messages.js'
import { createEnvelope, type BridgeEnvelope } from '../protocol/envelope.js'
import { flush, HOST_ORIGIN, SESSION } from '../testing.js'
import { sanitizeStageColors, sanitizeTheme } from './events.js'
import { INIT, setup } from './hostTestKit.js'

/**
 * 스테이지 컬러(운영자 설정 버튼·버튼 텍스트·스타)는 프레임이 호스트 `:root`를 상속하지 못해 따로 전달한다.
 * 값은 프레임 `:root` 인라인 스타일로 들어가므로 색 표기만 통과시킨다(url()·var()·식별자·주석 거절).
 */
describe('isStageColorValue', () => {
  it.each([
    '#654bff',
    '#FFF',
    '#654bff26',
    '#abcd',
    'rgb(1, 2, 3)',
    'rgba(1,2,3,0.15)',
    'hsl(250 100% 65%)',
    'hsla(250, 100%, 65%, .5)',
  ])('%s 허용', (v) => expect(isStageColorValue(v)).toBe(true))

  it.each([
    'red',
    'undefined',
    '#12',
    '#12345',
    '#gggggg',
    'url(https://x.test/a.png)',
    'var(--x)',
    'rgb(1,2,3);background:url(x)',
    'rgb(1,2,3)}',
    '#fff /* x */',
    'expression(alert(1))',
    'rgb( )',
    'rgb(,,,)',
    'rgb(1)',
    'rgb(89,74,)',
    'hsl(%%%)',
    'rgb(1,2,3)\n',
    `rgb(${'1,'.repeat(40)}1)`,
    '',
    123,
    null,
  ])('%s 거절', (v) => expect(isStageColorValue(v)).toBe(false))
})

describe('sanitizeTheme', () => {
  it('알려진 키의 올바른 값만 남긴다', () => {
    expect(
      sanitizeTheme({
        dark: true,
        colors: { button: '#594a3e', buttonText: 'url(x)', star: '#7ed321', extra: '#000' },
      }),
    ).toEqual({ dark: true, colors: { button: '#594a3e', star: '#7ed321' } })
  })

  it('남는 값이 없으면 colors 필드를 빼고, colors가 없던 옛 호스트 모양은 그대로다', () => {
    expect(sanitizeTheme({ dark: false, colors: { button: 'nope' } })).toEqual({ dark: false })
    expect(sanitizeTheme({ dark: true })).toEqual({ dark: true })
    expect(sanitizeStageColors(null)).toBeUndefined()
  })

  it('프로토타입 키는 복사하지 않는다', () => {
    const colors = Object.create({ button: '#000000' }) as Record<string, string>
    expect(sanitizeStageColors(colors)).toBeUndefined()
  })
})

describe('createBridgeHost — theme.colors', () => {
  const COLORS = {
    button: '#594a3e',
    buttonText: '#ffffff',
    buttonWeakA: '#594a3e26',
    star: '#7ed321',
  }

  it('init과 theme 이벤트에 정제된 colors를 싣는다', async () => {
    const { link, host: h } = setup({
      init: { ...INIT, theme: { dark: false, colors: { ...COLORS, token: 't' } } as never },
    })
    link.parent.postMessage(createEnvelope('evt', 'ready', 'r', { session: SESSION }), HOST_ORIGIN)
    await flush()
    const init = (link.toFrame[0].message as BridgeEnvelope<{ data: any }>).payload.data
    expect(init.theme).toEqual({ dark: false, colors: COLORS })

    h.send('theme', { dark: true, colors: { button: '#000000', star: 'javascript:1' } } as never)
    const last = link.toFrame[link.toFrame.length - 1]?.message as BridgeEnvelope
    expect(last.payload).toEqual({ dark: true, colors: { button: '#000000' } })
  })

  it('변수 이름 표는 플랫폼 이름과 같다', () => {
    expect(STAGE_COLOR_VARS).toEqual({
      button: '--button-color',
      buttonText: '--button-text-color',
      buttonWeakA: '--button-weak-a-color',
      star: '--star-color',
    })
  })
})
