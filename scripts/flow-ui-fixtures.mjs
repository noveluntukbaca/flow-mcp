// Real Playwright locators, sandboxed Electron, synthetic UI only. No Google requests or user Chrome profile.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { _electron } from 'playwright-core';
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), 'flow-native-fixtures ü '));
process.env.FLOW_MCP_HOME = join(scratch, 'home'); process.env.FLOW_MCP_OUTPUT = join(scratch, 'output');
const { NativeCharacterEngine, nativeCharacterCard } = await import('../dist/native-character.js');
const { CharacterStore, characterStore } = await import('../dist/character-store.js');
const { attachAsset, characterNamesOnPage } = await import('../dist/flow.js');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let electron;
try {
 electron = await _electron.launch({ args: [join(root, 'test/fixtures/flow-ui/electron.cjs'), `--user-data-dir=${join(scratch, 'electron')}`], env, timeout: 60000 });
 const real = await electron.firstWindow();
 const html = readFileSync(join(root, 'test/fixtures/flow-ui/native-project.html'), 'utf8');
 await real.route('**/*', route => {
  assert.equal(new URL(route.request().url()).hostname, 'flow-fixture.invalid');
  return route.fulfill({ contentType:'text/html', body:html });
 });
 const project = 'https://flow.google.com/project/offline-project';
 const projected = raw => new URL(raw.replace('flow-fixture.invalid','flow.google.com'));
 const page = new Proxy(real, { get(target, key) {
  if (key === 'url') return () => projected(target.url()).href;
  const value = Reflect.get(target,key); return typeof value === 'function' ? value.bind(target) : value;
 }});
 let caseNumber = 0;
 async function scenario(config = {}) {
  await real.goto('https://flow-fixture.invalid/project/offline-project');
  await real.evaluate(config => Object.assign(window.config, config), config);
  const store = new CharacterStore(join(scratch, 'case-'+(++caseNumber)));
  return { store, engine: new NativeCharacterEngine(store, ['timeout','ambiguous','wrong-project','pending-card'].includes(config.outcome) ? 1200 : 10000) };
 }
 const input = { name:'Local Fox', describe:'A red fox', personality:'Curious', voice:'LOCAL_VOICE' };
 let { engine, store } = await scenario();
 let out = await engine.create(page,input);
 assert.equal(out.status,'created'); assert.equal(out.name,'Local Fox'); assert.equal(out.flow_name,'Native Result 1');
 assert.equal(await real.evaluate(() => window.sentPrompt),'A red fox\n\nPersonality: Curious');
 assert.equal(await real.evaluate(() => window.uploads),0);
 assert.equal(store.resolve(project,'Local Fox'),'Native Result 1');
 assert.equal(await nativeCharacterCard(page,'native-1').count(),1); assert.equal(await nativeCharacterCard(page,'native-1').getAttribute('data-character-id'),'native-1');
 await real.evaluate(() => { const card = document.createElement('flow-character-tile'); card.setAttribute('aria-label','image fox'); card.textContent='image fox'; document.querySelector('#cards').append(card); });
 const localList = await characterNamesOnPage(page,store); assert.ok(localList.includes('image fox')); assert.ok(localList.includes('Local Fox')); assert.ok(!localList.includes('Native Result 1')); assert.ok(!localList.includes('New character') && !localList.includes('Create my avatar')); assert.equal(store.list(project)[0].voice,'LOCAL_VOICE');
 await engine.create(page,input); assert.equal(await real.evaluate(() => window.submits),1);
 out = await new NativeCharacterEngine(new CharacterStore(join(scratch,'case-'+caseNumber)),1800).create(page,input);
 assert.equal(out.status,'already_exists'); assert.equal(await real.evaluate(() => window.submits),1);
 console.log('PASS native text-only, field mapping, local identity/voice, duplicate/restart guard');
 characterStore.save(store.list(project)[0]);
 await real.getByRole('button',{name:'New character',exact:true}).click();
 await attachAsset(page,real.getByRole('button',{name:'Add from project',exact:true}),'Local Fox');
 assert.equal(await real.locator('#chips').innerText(),'Native Result 1 Character');
 console.log('PASS local asset alias attaches the exact native result, not a prefix-matching character');

 ({ engine, store } = await scenario({cost:20}));
 out = await engine.create(page,input); assert.equal(out.status,'confirmation_required'); assert.equal(out.quote,20);
 assert.equal(await real.evaluate(() => window.submits),0);
 const confirmed = {...input,confirmation_token:out.confirmation_token,max_credits:20};
 out = await engine.create(page,confirmed); assert.equal(out.status,'created'); assert.equal(await real.evaluate(() => window.submits),1);
 console.log('PASS positive price requires explicit token-bound approval');
 ({engine} = await scenario({outcome:'editor'})); out = await engine.create(page,{...input,name:'Editor Hero'}); assert.equal(out.status,'created');
 console.log('PASS editor result finishes only after a loaded generated portrait and card proof');

 ({engine} = await scenario({cost:null})); out = await engine.create(page,input);
 assert.equal(out.status,'blocked'); assert.equal(await real.evaluate(() => window.submits),0);
 assert.equal(await real.evaluate(() => window.uploads),0);
 console.log('PASS unknown cost ignores account balance and sample prompts');

 ({engine} = await scenario({cost:20})); out = await engine.create(page,input);
 await real.locator('#price').evaluate(node => node.textContent='30 credits');
 await assert.rejects(engine.create(page,{...input,confirmation_token:out.confirmation_token,max_credits:30}),/FLOW_NATIVE_PRICE_CHANGED/);
 assert.equal(await real.evaluate(() => window.submits),0);
 await assert.rejects(engine.create(page,{...input,confirmation_token:out.confirmation_token,max_credits:30}),/FLOW_NATIVE_CONSENT/);
 console.log('PASS changed quote and consumed tokens never submit');

 ({engine} = await scenario({cost:20})); out = await engine.create(page,input);
 await assert.rejects(engine.create(page,{...input,describe:'Changed',confirmation_token:out.confirmation_token,max_credits:20}),/FLOW_NATIVE_CONSENT/);
 assert.equal(await real.evaluate(() => window.submits),0);
 console.log('PASS changed input invalidates consent');
 ({store} = await scenario({cost:20})); engine = new NativeCharacterEngine(store,1800,1);
 out = await engine.create(page,input); await real.waitForTimeout(10);
 await assert.rejects(engine.create(page,{...input,confirmation_token:out.confirmation_token,max_credits:20}),/FLOW_NATIVE_CONSENT/);
 assert.equal(await real.evaluate(() => window.submits),0);
 ({engine} = await scenario());
 const first = engine.create(page,input);
 await assert.rejects(engine.create(page,{...input,name:'Concurrent'}),/FLOW_NATIVE_BUSY/);
 assert.equal((await first).status,'created'); assert.equal(await real.evaluate(() => window.submits),1);
 console.log('PASS expired approvals and concurrent requests cannot produce an extra submit');


 const path = join(scratch,'reference.png'); writeFileSync(path,'offline fixture');
 ({engine} = await scenario()); out = await engine.create(page,{name:'Image Fox', image:path, describe:'Fox using reference'});
 assert.equal(out.status,'created'); assert.equal(await real.evaluate(() => window.uploads),1); assert.equal(await real.evaluate(() => window.submits),1);
 ({engine} = await scenario()); out = await engine.create(page,{name:'Asset Fox',image:'asset:Reference',describe:'Fox'});
 assert.equal(out.status,'created'); assert.equal(await real.evaluate(() => window.uploads),1);
 console.log('PASS explicit Upload and Add from project modes');

 ({engine} = await scenario({cost:20,attachedCost:30})); out = await engine.create(page,{...input,image:path});
 assert.equal(out.status,'confirmation_required'); assert.equal(await real.evaluate(() => window.uploads),0);
 out = await engine.create(page,{...input,image:path,confirmation_token:out.confirmation_token,max_credits:20});
 assert.equal(out.status,'confirmation_required'); assert.equal(out.quote,30); assert.equal(await real.evaluate(() => window.submits),0);
 out = await engine.create(page,{...input,image:path,confirmation_token:out.confirmation_token,max_credits:30});
 assert.equal(out.status,'created'); assert.equal(await real.evaluate(() => window.uploads),1);
 console.log('PASS paid image review before upload, attachment price change re-confirmed');

 for (const outcome of ['timeout','ambiguous','wrong-project','pending-card']) {
  ({engine,store} = await scenario({outcome}));
  await assert.rejects(engine.create(page,input),/FLOW_NATIVE_RESULT_UNCERTAIN/);
  assert.equal(await real.evaluate(() => window.submits),1);
  // Restore only the URL after wrong-project; the durable ledger still blocks another submit.
  if (outcome==='wrong-project') await real.evaluate(() => history.pushState(null,'','/project/offline-project'));
  out = await new NativeCharacterEngine(store,500).create(page,input);
  assert.equal(out.status,'blocked'); assert.equal(await real.evaluate(() => window.submits),1);
 }
 console.log('PASS timeout/ambiguous/navigation failures persist no-resubmit ledger');

 ({engine,store} = await scenario({unexpectedUpload:true}));
 await assert.rejects(engine.create(page,{name:'Upload guard',image:path}),/FLOW_NATIVE_ATTACHMENT_UNCERTAIN/);
 out = await new NativeCharacterEngine(store,500).create(page,{name:'Upload guard',image:path});
 assert.equal(out.status,'blocked'); assert.equal(await real.evaluate(() => window.uploads),1);
 console.log('PASS unexpected legacy upload/navigation cannot be retried');

 for (const config of [{model:'Unknown model'},{unsafeArrow:true},{disabled:true}]) {
  ({engine} = await scenario(config)); await assert.rejects(engine.create(page,input),/FLOW_NATIVE_/);
  assert.equal(await real.evaluate(() => window.submits),0);
 }
 assert.equal(await real.evaluate(() => window.avatarClicks),0);
 console.log('PASS unsupported models/arrows, disabled submit, avatar never chosen');
 console.log('Native character composer fixture suite: PASS; no Google requests or credits.');
} finally { await electron?.close().catch(()=>{}); rmSync(scratch,{recursive:true,force:true}); }
