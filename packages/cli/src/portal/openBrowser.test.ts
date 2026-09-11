import { describe, expect, it, vi } from 'vitest'
import { openBrowser } from './openBrowser.js'

const { calls } = vi.hoisted(() => ({ calls: [] as string[][] }))

vi.mock('node:child_process', () => ({
  execFile: (
    cmd: string,
    args: string[],
    _opts: unknown,
    cb: (err: Error | null) => void,
  ): void => {
    calls.push([cmd, ...args])
    cb(null)
  },
}))

describe('openBrowser', () => {
  it('http·https 는 연다', async () => {
    calls.length = 0
    expect(await openBrowser('https://portal.example/device?code=A')).toBe(true)
    expect(await openBrowser('http://localhost:3000/device')).toBe(true)
    expect(calls).toHaveLength(2)
  })

  it.each([
    ['file:///etc/passwd'],
    ['javascript:alert(1)'],
    ['data:text/html,<script>x</script>'],
    ['portal.example/device'],
  ])('http(s)가 아닌 %s 는 실행하지 않고 false', async (url) => {
    calls.length = 0
    expect(await openBrowser(url)).toBe(false)
    expect(calls).toEqual([])
  })

  it.each([
    ['https://portal.example/d?c=A&b=1'],
    ['https://portal.example/d?c=A|calc'],
    ['https://portal.example/d?c=A^B'],
    ['https://portal.example/d?c=<B'],
    ['https://portal.example/d?c=A>B'],
    ['https://portal.example/d?c=%PATH%'],
    ['https://portal.example/d?c=A!B'],
    ['https://portal.example/d?c=A`B'],
    ["https://portal.example/d?c=A'B"],
  ])('셸 메타문자가 든 %s 는 실행하지 않고 false', async (url) => {
    calls.length = 0
    expect(await openBrowser(url)).toBe(false)
    expect(calls).toEqual([])
  })

  it('win32 는 cmd.exe 가 아니라 rundll32 로 연다', async () => {
    calls.length = 0
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      expect(await openBrowser('https://portal.example/cli/authorize?code=ABCD-EFGH')).toBe(true)
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true })
    }
    expect(calls).toEqual([
      [
        'rundll32',
        'url.dll,FileProtocolHandler',
        'https://portal.example/cli/authorize?code=ABCD-EFGH',
      ],
    ])
  })
})
