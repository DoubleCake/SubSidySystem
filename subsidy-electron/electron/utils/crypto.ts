/**
 * 密码哈希工具 — 使用 PBKDF2（零外部依赖）
 * 存储格式: salt:hash (base64)
 */
import { randomBytes, pbkdf2Sync } from 'crypto'

const ITERATIONS = 210_000
const KEY_LEN = 64
const DIGEST = 'sha512'

/** 哈希密码，返回 "salt:hash" */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('base64')
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST).toString('base64')
  return `${salt}:${hash}`
}

/** 验证明文密码是否匹配已存储的哈希 */
export function verifyPassword(password: string, stored: string): boolean {
  // 兼容旧明文密码（不含 `:` 分隔符）
  if (!stored.includes(':')) {
    return password === stored
  }
  const [salt, hash] = stored.split(':')
  const computed = pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST).toString('base64')
  return hash === computed
}

/** 判断存储值是否为旧格式明文（需要迁移） */
export function isLegacyPassword(stored: string): boolean {
  return !stored.includes(':')
}
