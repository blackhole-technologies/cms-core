/**
 * test/index.js - Test module
 */

export async function hook_boot(context) {
  console.log('[test] Boot hook fired');
}

export async function hook_ready(context) {
  console.log('[test] Ready and working!');
}

/**
 * CLI hook - register test commands
 */
export function hook_cli(register, context) {
  register('test:ping', async (args, ctx) => {
    console.log('pong!');
  }, 'Respond with pong');
}

/**
 * Routes hook - register HTTP routes
 */
export function hook_routes(register, context) {
  const server = context.services.get('server');

  /**
   * GET /ping → returns "pong"
   */
  register('GET', '/ping', async (req, res, params, ctx) => {
    server.text(res, 'pong');
  }, 'Ping endpoint');
}
