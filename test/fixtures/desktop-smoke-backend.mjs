// Only loaded by the smoke test runner, never by the desktop application.
import { startServer } from '../../dist/server.js';
let createdName;
const core = {
  techniques: async () => [],
  voices: async () => ({ gemini: [], mac: [] }),
  characters: async () => createdName ? [{name:createdName,use_as:`asset:${createdName}`}] : [],
  character: async args => {
    process.send({ type:"character-call", args });
    if (args.name === "Unknown pricing") return {status:"blocked",name:args.name,message:"Biaya tidak dapat diverifikasi. Submit diblokir."};
    if (!args.confirmation_token) return {status:"confirmation_required",name:args.name,quote:20,model:"Nano Banana 2.1",confirmation_token:"a".repeat(48),message:"Tinjau biaya 20 kredit."};
    if (args.confirmation_token !== "a".repeat(48) || args.max_credits !== 20) throw Error("Invalid fake consent");
    createdName = args.name; return {status:"created",name:args.name,message:"Karakter fixture dibuat.",use_as:`asset:${args.name}`};
  },
  outputs: async () => ({ projects: [] }),
  status: async () => ({ flow: { signedIn: false, inProject: false }, jobs: [] }),
};
const role = await startServer(core);
process.send({ role });
