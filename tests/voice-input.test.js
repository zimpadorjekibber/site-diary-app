import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceManager } from '../src/speech.js';
import { speechLanguage } from '../src/voice-input.js';

const store = {getSettings:()=>({language:'en'}),getWorkers:()=>[{id:'r',name:'Ramesh',tradeId:'mason'}],getTrades:()=>[{id:'mason',name:'Mason'}]};
function browser() {
  class Recognition {
    start() { this.started=true; }
    stop() { this.onend(); }
  }
  const voice=new VoiceManager(store,{platform:'web',recognitionClass:Recognition});
  const results=[], statuses=[];
  voice.startListening((...args)=>results.push(args),(...args)=>statuses.push(args));
  return {voice,recognition:voice.recognition,results,statuses};
}
const result=(text,isFinal=true)=>Object.assign([{transcript:text}],{isFinal});

test('Android voice uses the native provider even when Web Speech is absent', async () => {
  let options;
  const voice=new VoiceManager(store,{platform:'android',nativeSpeech:{start:async o=>{options=o;return {text:'Ramesh 500 rupees'};}}});
  const results=[], statuses=[];
  assert.equal(voice.isSupported(),true);
  await voice.startListening((...args)=>results.push(args),(...args)=>statuses.push(args));
  assert.equal(options.language,'hi-IN');
  assert.equal(results.length,1);
  assert.equal(results[0][2].workerId,'r');
  assert.equal(results[0][2].amount,500);
  assert.equal(results[0][3],null);
  assert.equal(voice.isListening,false);
  assert.equal(statuses.at(-1)[0],false);
});

test('spoken language stays independent of UI language and uses locale codes', () => {
  assert.equal(speechLanguage({language:'en'}),'hi-IN');
  assert.equal(speechLanguage({speechLanguage:'en'}),'en-IN');
  assert.equal(speechLanguage({speechLanguage:'hi-IN'}),'hi-IN');
});

test('native permission, cancellation, unavailable and empty results never produce blank entries', async () => {
  for (const code of ['PERMISSION_DENIED','CANCELLED','UNAVAILABLE','NETWORK',null]) {
    const voice=new VoiceManager(store,{platform:'android',nativeSpeech:{start:async()=>{if(code)throw {code};return {text:' '};}}});
    const results=[],statuses=[];
    await voice.startListening((...a)=>results.push(a),(...a)=>statuses.push(a));
    assert.equal(results.length,0);
    assert.equal(voice.isListening,false);
    assert.equal(statuses.at(-1)[0],false);
    assert.ok(statuses.at(-1)[1].length>15);
  }
});

test('repeated taps cannot open two native dialogs and a failed request can retry', async () => {
  let resolve, calls=0;
  const voice=new VoiceManager(store,{platform:'android',nativeSpeech:{start:()=>{calls++;return new Promise(r=>{resolve=r;});}}});
  const pending=voice.startListening(()=>{},()=>{});
  await voice.startListening(()=>{throw Error('second call');},()=>{});
  assert.equal(calls,1);
  resolve({text:''}); await pending;
  const retry=voice.startListening(()=>{},()=>{});
  assert.equal(calls,2);
  resolve({text:'Ramesh 500'}); await retry;
});

test('browser errors survive onend and cannot become empty completed results', () => {
  const {voice,recognition,results,statuses}=browser();
  recognition.onerror({error:'not-allowed'});
  recognition.onend();
  assert.equal(results.length,0);
  assert.match(statuses.at(-1)[1],/Microphone permission/);
  assert.equal(voice.isListening,false);
});

test('browser final results are not duplicated and repeated end events submit once', () => {
  const {voice,recognition,results}=browser();
  const event={resultIndex:0,results:[result('Ramesh 500 rupees')]};
  recognition.onresult(event); recognition.onresult(event);
  recognition.onend(); recognition.onend();
  const finals=results.filter(r=>r[1]);
  assert.equal(finals.length,1);
  assert.equal(finals[0][0],'Ramesh 500 rupees');
  assert.equal(voice.transcript,'Ramesh 500 rupees');
});

test('browser interim speech is retained when the provider ends without a final event', () => {
  const {recognition,results}=browser();
  recognition.onresult({resultIndex:0,results:[result('Ramesh 700',false)]});
  recognition.onend();
  assert.equal(results.at(-1)[0],'Ramesh 700');
  assert.equal(results.at(-1)[2].amount,700);
});

test('unsupported browser reports a useful status and synchronous startup failure resets the mic', async () => {
  for (const recognitionClass of [null,class {start(){throw Error('blocked');}}]) {
    const voice=new VoiceManager(store,{platform:'web',recognitionClass});
    const statuses=[];
    await voice.startListening(()=>{throw Error('unexpected entry');},(...a)=>statuses.push(a));
    assert.equal(voice.isListening,false);
    assert.equal(statuses.at(-1)[0],false);
  }
});
