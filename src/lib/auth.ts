// 평문 비밀번호를 번들에 남기지 않도록 SHA-256 해시만 보관
const PASSWORD_HASH = '6f69950d0a46a581006e6bb2a47c24f333b2173e3e9ceb59901480ec0e3b4a47'
const STORAGE_KEY = 'sg-dashboard-auth'

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const isUnlocked = () => localStorage.getItem(STORAGE_KEY) === PASSWORD_HASH

export function lock() {
  localStorage.removeItem(STORAGE_KEY)
}

export async function checkPassword(input: string) {
  return (await sha256(input)) === PASSWORD_HASH
}

export function saveAuth() {
  localStorage.setItem(STORAGE_KEY, PASSWORD_HASH)
}
