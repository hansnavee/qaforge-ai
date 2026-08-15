/** Deterministic embedding when no hosted embedding API is configured. */
export function hashEmbedding(text: string, dims = 32): number[] {
  const vec = new Array(dims).fill(0);
  const src = text.toLowerCase().replace(/\s+/g, ' ').trim();
  for (let i = 0; i < src.length; i += 1) {
    const code = src.charCodeAt(i);
    vec[i % dims] += code / 255;
    vec[(i * 7) % dims] += ((code * 13) % 97) / 97;
  }
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / mag);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < n; i += 1) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    magA += (a[i] ?? 0) ** 2;
    magB += (b[i] ?? 0) ** 2;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom ? dot / denom : 0;
}
