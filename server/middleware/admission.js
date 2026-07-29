/**
 * @typedef {{ perUser: number, global: number }} AdmissionLimits
 */

/**
 * Creates a no-queue concurrency controller. Callers either acquire immediately
 * or receive a deterministic overload result.
 *
 * @param {Record<string, AdmissionLimits>} policies
 */
export function createAdmissionController(policies) {
  const buckets = new Map();

  function getBucket(category) {
    const limits = policies[category];
    if (!limits) throw new Error(`Unknown admission category: ${category}`);
    let bucket = buckets.get(category);
    if (!bucket) {
      bucket = { active: 0, users: new Map() };
      buckets.set(category, bucket);
    }
    return { bucket, limits };
  }

  function tryAcquire(category, userId) {
    const { bucket, limits } = getBucket(category);
    const normalizedUserId = String(userId || 'anonymous');
    const userActive = bucket.users.get(normalizedUserId) || 0;

    if (userActive >= limits.perUser) {
      return { acquired: false, reason: 'user_limit' };
    }
    if (bucket.active >= limits.global) {
      return { acquired: false, reason: 'global_limit' };
    }

    bucket.active++;
    bucket.users.set(normalizedUserId, userActive + 1);
    let released = false;
    return {
      acquired: true,
      release() {
        if (released) return;
        released = true;
        bucket.active = Math.max(0, bucket.active - 1);
        const remaining = (bucket.users.get(normalizedUserId) || 1) - 1;
        if (remaining > 0) bucket.users.set(normalizedUserId, remaining);
        else bucket.users.delete(normalizedUserId);
      }
    };
  }

  function snapshot(category) {
    const { bucket } = getBucket(category);
    return {
      active: bucket.active,
      users: new Map(bucket.users)
    };
  }

  return { tryAcquire, snapshot };
}
/**
 * @param {{
 *   controller: ReturnType<typeof createAdmissionController>,
 *   selectCategory: (req: any) => string,
 *   identify: (req: any) => string,
 *   retryAfterSeconds?: number
 * }} options
 */
export function createAdmissionMiddleware({
  controller,
  selectCategory,
  identify,
  retryAfterSeconds = 5
}) {
  return function admissionMiddleware(req, res, next) {
    const lease = controller.tryAcquire(selectCategory(req), identify(req));
    if (!lease.acquired) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
      if (lease.reason === 'user_limit') {
        return res.status(429).json({
          error: '当前用户的 AI 请求过多，请稍后重试',
          code: 'AI_PROXY_USER_BUSY'
        });
      }
      return res.status(503).json({
        error: 'AI 代理当前繁忙，请稍后重试',
        code: 'AI_PROXY_BUSY'
      });
    }

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      res.off?.('finish', release);
      res.off?.('close', release);
      lease.release();
    };
    res.once('finish', release);
    res.once('close', release);
    next();
  };
}
