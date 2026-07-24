import compression from 'compression';

const AI_PROXY_PATH = '/api/ai-proxy';

export function responseCompressionFilter(req, res) {
  // compression evaluates its filter when response headers are written. By then an
  // Express Router may have trimmed req.url/req.path to '/', while originalUrl still
  // contains the application-level mount path.
  const requestPath = String(req.originalUrl || req.url || req.path || '').split('?')[0];
  if (requestPath === AI_PROXY_PATH || requestPath.startsWith(`${AI_PROXY_PATH}/`)) {
    return false;
  }
  return compression.filter(req, res);
}

export function createResponseCompression() {
  return compression({ filter: responseCompressionFilter });
}
