import { describe, expect, it } from 'vitest'
import { uuid } from './uuid.js'

describe('uuid', () => {
  it('v4 형식이고 매번 다른 값을 만든다', () => {
    const a = uuid()
    const b = uuid()

    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a).not.toBe(b)
  })
})
