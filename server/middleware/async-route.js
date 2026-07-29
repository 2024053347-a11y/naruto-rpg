/**
 * Express 4 does not forward rejected route-handler promises to error middleware.
 * Keep the wrapper at registration sites so synchronous and asynchronous failures
 * share the same error boundary.
 *
 * @param {(req: any, res: any, next: any) => any} handler
 */
export function asyncRoute(handler) {
  return function asyncRouteHandler(req, res, next) {
    Promise.resolve()
      .then(() => handler(req, res, next))
      .catch(next);
  };
}
