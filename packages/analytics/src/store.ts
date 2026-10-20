export interface Store {
  get(name: string): string | null
  set(name: string, value: string, maxAge: number): void
  remove(name: string): void
}

export const cookieStore: Store = {
  get(name) {
    const prefix = `${name}=`
    for (const chunk of document.cookie.split('; ')) {
      if (!chunk.startsWith(prefix)) continue
      const raw = chunk.slice(prefix.length)
      try {
        return decodeURIComponent(raw)
      } catch {
        return null
      }
    }
    return null
  },

  set(name, value, maxAge) {
    const v = encodeURIComponent(value)
    document.cookie = `${name}=${v}; path=/; max-age=${maxAge}; SameSite=Lax; Secure`
  },

  remove(name) {
    document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`
  },
}
