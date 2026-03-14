export interface Capabilities {
  webgpu: boolean;
  mobile: boolean;
  tier: 1 | 2 | 3;
  dpr: number;
}

function detectMobile(): boolean {
  const ua = navigator.userAgent;
  const mobileRegex =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;
  const hasTouch =
    'ontouchstart' in window || navigator.maxTouchPoints > 0;
  return mobileRegex.test(ua) || hasTouch;
}

function detectWebGPU(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu != null;
}

function determineTier(mobile: boolean): 1 | 2 | 3 {
  if (mobile) return 3;

  // Heuristic: check hardware concurrency and memory as proxy for GPU tier
  const cores = navigator.hardwareConcurrency ?? 2;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;

  if (cores >= 8 && memory >= 8) return 1;
  if (cores >= 4 && memory >= 4) return 2;
  return 2;
}

export function getCapabilities(): Capabilities {
  const webgpu = detectWebGPU();
  const mobile = detectMobile();
  const tier = determineTier(mobile);
  const rawDpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  const dpr = Math.min(rawDpr, 2.0);

  return { webgpu, mobile, tier, dpr };
}
