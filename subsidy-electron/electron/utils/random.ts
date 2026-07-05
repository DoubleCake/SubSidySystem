/**
 * 确定性伪随机数生成器（对应 Python random.seed(42))
 * 使用 mulberry32 算法
 */
export function randomSeed(seed: number) {
  let state = seed

  function next(): number {
    state |= 0
    state = (state + 0x6D2B79F5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    /** 返回 [0, 1) 的随机浮点数 */
    random: next,

    /** 返回 [min, max] 的随机整数 */
    nextInt(min: number, max: number): number {
      return Math.floor(next() * (max - min + 1)) + min
    },

    /** 返回 [min, max] 的随机浮点数 */
    uniform(min: number, max: number): number {
      return next() * (max - min) + min
    },

    /** 从数组中随机选一个元素 */
    choice<T>(arr: T[]): T {
      return arr[Math.floor(next() * arr.length)]
    },

    /** 带权重的随机选择 */
    weightedChoice<T>(items: T[], weights: number[]): T {
      const total = weights.reduce((a, b) => a + b, 0)
      let r = next() * total
      for (let i = 0; i < items.length; i++) {
        r -= weights[i]
        if (r <= 0) return items[i]
      }
      return items[items.length - 1]
    },

    /** 从数组中随机抽样 n 个元素 */
    sample<T>(arr: T[], n: number): T[] {
      const shuffled = [...arr]
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }
      return shuffled.slice(0, Math.min(n, arr.length))
    },
  }
}
