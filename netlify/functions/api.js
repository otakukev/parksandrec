const serverless = require('serverless-http');
const app = require('../../app');

const proxy = serverless(app);
const FUNCTION_PREFIX = '/.netlify/functions/api';

// Our Express routes expect the original "/api/..." (or "/healthz") path.
// Depending on Netlify's redirect handling, the incoming event.path may
// already be that original path, or the rewritten destination path under
// FUNCTION_PREFIX — normalize either shape to what the app expects.
module.exports.handler = async (event, context) => {
  let requestPath = event.path || '/';
  if (requestPath.startsWith(FUNCTION_PREFIX)) {
    requestPath = requestPath.slice(FUNCTION_PREFIX.length) || '/';
    if (requestPath !== '/healthz' && !requestPath.startsWith('/api')) {
      requestPath = `/api${requestPath}`;
    }
  }
  return proxy({ ...event, path: requestPath }, context);
};
