import { Capacitor, registerPlugin } from '@capacitor/core';

const nativeSpeech = registerPlugin('SiteSpeech');
export const speechLanguage = settings => {
  const language = settings.speechLanguage || 'hi-IN';
  return language.startsWith('en') ? 'en-IN' : 'hi-IN';
};

export class VoiceInput {
  constructor(store, options = {}) {
    this.store = store;
    this.platform = options.platform ?? Capacitor.getPlatform();
    this.nativeSpeech = options.nativeSpeech ?? nativeSpeech;
    this.Recognition = options.recognitionClass ?? globalThis.window?.SpeechRecognition ?? globalThis.window?.webkitSpeechRecognition;
    this.recognition = null;
    this.isListening = false;
    this.transcript = '';
    this.session = null;
  }

  isSupported() { return this.platform === 'android' || !!this.Recognition; }

  message(code) {
    const en = String(this.store.getSettings().language || '').startsWith('en');
    const messages = {
      listening: ['सुन रहा हूँ… बोलिए।','Listening… please speak.'],
      completed: ['आवाज़ लिख दी है। एंट्री जाँचकर सेव करें।','Speech captured. Review the entry before saving.'],
      NO_SPEECH: ['आवाज़ नहीं मिली। माइक दबाकर फिर बोलें।','No speech captured. Tap the mic and try again.'],
      PERMISSION_DENIED: ['माइक्रोफ़ोन की अनुमति चाहिए। फ़ोन की Settings → Apps → Shram Site Diary → Permissions में Microphone चालू करें।','Microphone permission is needed. Enable it in phone Settings → Apps → Shram Site Diary → Permissions.'],
      UNAVAILABLE: ['फ़ोन में voice recognition उपलब्ध नहीं है। Google ऐप चालू/अपडेट करें, या लिखकर एंट्री करें।','Voice recognition is unavailable. Enable/update the Google app, or type your entry.'],
      NETWORK: ['आवाज़ पहचानने के लिए इंटरनेट जाँचें और फिर बोलें।','Check your internet connection and try voice input again.'],
      CANCELLED: ['बोलकर एंट्री रद्द हुई। फिर माइक दबा सकते हैं।','Voice input cancelled. Tap the mic to try again.'],
      AUDIO_CAPTURE: ['माइक्रोफ़ोन नहीं मिल रहा। दूसरी recording/call बंद करके फिर कोशिश करें।','Microphone unavailable. End other recordings/calls and try again.'],
      LANGUAGE: ['बोलने की भाषा बदलकर फिर कोशिश करें।','Change the spoken language and try again.'],
      FAILED: ['आवाज़ पहचान नहीं पाए। फिर माइक दबाएँ या लिखकर जोड़ें।','Could not recognize speech. Try again or type your entry.'],
    };
    return (messages[code] || messages.FAILED)[en ? 1 : 0];
  }

  async startListening(onResult, onStatusChange) {
    if (this.session) return;
    const session = {onResult, onStatusChange, final:'', interim:'', failed:false, ended:false};
    this.session = session;
    this.transcript = '';
    this.isListening = true;
    onStatusChange?.(true, this.message('listening'));
    const language = speechLanguage(this.store.getSettings());
    if (this.platform === 'android') {
      // The system recognizer owns the microphone. A simultaneous MediaRecorder
      // can prevent it from hearing speech, so this path does not record a second clip.
      try {
        const result = await this.nativeSpeech.start({language,prompt:language === 'en-IN' ? 'e.g. Paid Ramesh 500 rupees' : 'जैसे: रमेश को 500 रुपये दिए'});
        if (this.session !== session) return;
        this.finish(session, String(result?.text || '').trim());
      } catch (error) {
        if (this.session === session) this.fail(session, error.code || 'FAILED');
      }
      return;
    }
    if (!this.Recognition) { this.fail(session, 'UNAVAILABLE'); return; }
    try {
      const recognition = this.recognition = new this.Recognition();
      recognition.lang = language;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.onresult = event => {
        if (this.session !== session || session.failed) return;
        // Rebuild from the result list, rather than appending the same final twice.
        let final = '', interim = '';
        for (let i=0; i<event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) final += `${result[0].transcript} `;
          else interim += `${result[0].transcript} `;
        }
        session.final = final.trim(); session.interim = interim.trim();
        const text = `${final}${interim}`.trim();
        if (text) onResult?.(text, false);
      };
      recognition.onerror = event => {
        if (this.session !== session) return;
        const codes = {'not-allowed':'PERMISSION_DENIED','service-not-allowed':'PERMISSION_DENIED','no-speech':'NO_SPEECH','audio-capture':'AUDIO_CAPTURE',network:'NETWORK','language-not-supported':'LANGUAGE',aborted:'CANCELLED'};
        this.fail(session, codes[event.error] || 'FAILED');
      };
      recognition.onend = () => {
        if (this.session === session && !session.failed) this.finish(session, session.final || session.interim);
      };
      recognition.start();
    } catch { this.fail(session, 'FAILED'); }
  }

  finish(session, text) {
    if (!text) { this.fail(session, 'NO_SPEECH'); return; }
    if (this.session !== session || session.ended) return;
    session.ended = true;
    this.session = null; this.isListening = false; this.transcript = text;
    session.onResult?.(text, true, this.parseTranscript(text), null);
    session.onStatusChange?.(false, this.message('completed'));
  }

  fail(session, code) {
    session.failed = true;
    this.session = null; this.isListening = false;
    session.onStatusChange?.(false, this.message(code));
  }

  stopListening() {
    const session = this.session;
    if (!session) return;
    if (this.platform !== 'android' && this.recognition) {
      try { this.recognition.stop(); } catch { this.fail(session, 'FAILED'); }
    }
    // Android's voice dialog has its own Done/Back controls. Do not start another
    // request while it is still awaiting a result.
  }
}
