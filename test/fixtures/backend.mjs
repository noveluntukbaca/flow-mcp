// A child-process backend with no LocalCore/Chrome/Flow methods ever invoked.
import { shapes } from '../../dist/core.js';
import { startServer } from '../../dist/server.js';
const core = Object.fromEntries(Object.keys(shapes).map(method => [method, async args => ({ method, args, finished: true })]));
core.characters = async () => ({ method: 'characters' });
core.outputs = async () => ({ method: 'outputs' });
const role = await startServer(core);
process.send({ role });
