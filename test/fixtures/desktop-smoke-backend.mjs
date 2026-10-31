// Only loaded by the smoke test runner, never by the desktop application.
import { startServer } from '../../dist/server.js';
const core = {
  techniques: async () => [],
  voices: async () => ({ gemini: [], mac: [] }),
  characters: async () => [],
  outputs: async () => ({ projects: [] }),
  status: async () => ({ flow: { signedIn: false, inProject: false }, jobs: [] }),
};
const role = await startServer(core);
process.send({ role });
