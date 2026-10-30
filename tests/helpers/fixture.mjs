import { LocalCore } from '../../dist/core.js';
import { startServer } from '../../dist/server.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// No Flow driver methods: an unexpected call fails instead of reaching Google.
const local = new LocalCore();
const core = {
  techniques: local.techniques.bind(local),
  outputs: local.outputs.bind(local),
  discard: local.discard.bind(local),
  generate: async () => { throw new Error('Flow disabled in offline tests'); },
};
globalThis.fetch = async () => { throw new Error('Outbound fetch disabled in offline fixture'); };
if (await startServer(core) !== 'owner') throw new Error('Fixture could not own its port');
process.send({ ready: true, token: readFileSync(join(process.env.FLOW_MCP_HOME, 'token'), 'utf8').trim() });
