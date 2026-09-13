// src/speech.js
// Voice Dictation (Web Speech API) + Audio Recording Backup + Hindi/Hinglish Smart NLP Parser

export class VoiceManager {
  constructor(store) {
    this.store = store;
    this.recognition = null;
    this.isListening = false;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.currentAudioDataUrl = null;
    this.transcript = '';
    this.onResultCallback = null;
    this.onStatusChangeCallback = null;
    this.initRecognition();
  }

  initRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false;
      this.recognition.interimResults = true;
      this.recognition.lang = this.store.getSettings().language || 'hi-IN';

      this.recognition.onstart = () => {
        this.isListening = true;
        this.transcript = '';
        if (this.onStatusChangeCallback) this.onStatusChangeCallback(true, 'सुन रहा हूँ... बोलिए (Listening...)');
      };

      this.recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            this.transcript += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        const fullText = (this.transcript + ' ' + interim).trim();
        if (this.onResultCallback) this.onResultCallback(fullText, false);
      };

      this.recognition.onerror = (event) => {
        console.warn('Speech recognition error:', event.error);
        this.isListening = false;
        if (this.onStatusChangeCallback) this.onStatusChangeCallback(false, `आवाज़ पहचानने में समस्या (${event.error})`);
      };

      this.recognition.onend = () => {
        this.isListening = false;
        this.stopAudioRecording();
        const parsed = this.parseTranscript(this.transcript);
        if (this.onResultCallback) this.onResultCallback(this.transcript, true, parsed, this.currentAudioDataUrl);
        if (this.onStatusChangeCallback) this.onStatusChangeCallback(false, 'रुक गया (Completed)');
      };
    }
  }

  isSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  async startListening(onResult, onStatusChange) {
    this.onResultCallback = onResult;
    this.onStatusChangeCallback = onStatusChange;
    this.transcript = '';
    this.currentAudioDataUrl = null;

    // Start audio recording in parallel for audio playback backup
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.mediaRecorder = new MediaRecorder(stream);
        this.audioChunks = [];
        this.mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) this.audioChunks.push(e.data);
        };
        this.mediaRecorder.onstop = () => {
          if (this.audioChunks.length > 0) {
            const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.onloadend = () => {
              this.currentAudioDataUrl = reader.result;
            };
            reader.readAsDataURL(blob);
          }
          // Stop stream tracks
          stream.getTracks().forEach(t => t.stop());
        };
        this.mediaRecorder.start();
      }
    } catch (e) {
      console.log('Audio recording permission denied or not available, proceeding with speech recognition only.');
    }

    if (this.recognition) {
      try {
        this.recognition.lang = this.store.getSettings().language || 'hi-IN';
        this.recognition.start();
      } catch (err) {
        console.warn('Recognition start failed:', err);
        if (this.onStatusChangeCallback) this.onStatusChangeCallback(false, 'माइक्रोफ़ोन चालू नहीं हो सका');
      }
    } else {
      if (this.onStatusChangeCallback) {
        this.onStatusChangeCallback(false, 'इस ब्राउज़र में स्पीच रिकग्निशन उपलब्ध नहीं है। आप नीचे लिखकर जोड़ सकते हैं।');
      }
    }
  }

  stopListening() {
    if (this.recognition && this.isListening) {
      this.recognition.stop();
    }
    this.stopAudioRecording();
    this.isListening = false;
  }

  stopAudioRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch (e) {
        console.warn(e);
      }
    }
  }

  // Smart Parser for Hindi/Hinglish/English voice notes
  parseTranscript(text) {
    if (!text) return null;
    const lower = text.toLowerCase();

    const workers = this.store.getWorkers();
    const trades = this.store.getTrades();

    let detectedTrade = null;
    let detectedWorker = null;
    let targetType = 'individual'; // 'individual' or 'group'
    let transactionType = 'cash'; // 'cash' | 'ration' | 'recharge'
    let rationItem = '';
    let quantity = '';
    let amount = 0;
    let role = null; // 'mistri' | 'helper'

    // 1. Check for Trade Keywords
    const tradeKeywords = {
      carpenter: ['carpenter', 'बढ़ई', 'badhai', 'badhai group', 'लकड़ी'],
      mason: ['mason', 'राजमिस्त्री', 'rajmistri', 'mistri group', 'मिस्त्री ग्रुप'],
      plumber: ['plumber', 'प्लंबर', 'नल'],
      painter: ['painter', 'पेंटर', 'रंग', 'रंगाई'],
      electrician: ['electrician', 'बिजली', 'बिजली मिस्त्री', 'इलेक्ट्रिशियन'],
      tile: ['tile', 'marble', 'टाइल', 'मार्बल']
    };

    for (const [tradeId, keywords] of Object.entries(tradeKeywords)) {
      if (keywords.some(k => lower.includes(k))) {
        detectedTrade = trades.find(t => t.id === tradeId) || { id: tradeId };
        break;
      }
    }

    // 2. Check for Worker Names
    for (const worker of workers) {
      const wNameLower = worker.name.toLowerCase();
      const parts = wNameLower.split(' ');
      if (lower.includes(wNameLower) || parts.some(p => p.length > 2 && lower.includes(p))) {
        detectedWorker = worker;
        if (!detectedTrade) {
          detectedTrade = trades.find(t => t.id === worker.tradeId);
        }
        break;
      }
    }

    // 3. Check for Mistri vs Helper mention
    if (lower.includes('helper') || lower.includes('हेल्पर') || lower.includes('मजदूर') || lower.includes('लेबर')) {
      role = 'helper';
    } else if (lower.includes('mistri') || lower.includes('मिस्त्री') || lower.includes('कारीगर') || lower.includes('मास्टर')) {
      role = 'mistri';
    }

    // 4. Check for Group mention
    if (
      lower.includes('group') ||
      lower.includes('ग्रुप') ||
      lower.includes('सबके लिए') ||
      lower.includes('सारे') ||
      lower.includes('all') ||
      lower.includes('team')
    ) {
      targetType = 'group';
      detectedWorker = null; // group expense
    }

    // 5. Check Transaction Type: Ration, Recharge, Cash
    // Ration items check
    if (lower.includes('atta') || lower.includes('आटा')) {
      transactionType = 'ration';
      rationItem = 'Atta (आटा)';
      targetType = detectedWorker ? 'individual' : 'group'; // default group unless specific worker named
    } else if (lower.includes('chawal') || lower.includes('rice') || lower.includes('चावल')) {
      transactionType = 'ration';
      rationItem = 'Rice (चावल)';
      targetType = detectedWorker ? 'individual' : 'group';
    } else if (lower.includes('cylinder') || lower.includes('सिलेंडर') || lower.includes('gas') || lower.includes('गैस')) {
      transactionType = 'ration';
      rationItem = 'Gas Cylinder (गैस सिलेंडर)';
      quantity = '1 Cylinder';
      targetType = detectedWorker ? 'individual' : 'group';
    } else if (lower.includes('tel') || lower.includes('oil') || lower.includes('तेल')) {
      transactionType = 'ration';
      rationItem = 'Cooking Oil (खाद्य तेल)';
      targetType = detectedWorker ? 'individual' : 'group';
    } else if (lower.includes('dal') || lower.includes('दाल')) {
      transactionType = 'ration';
      rationItem = 'Dal (दाल)';
      targetType = detectedWorker ? 'individual' : 'group';
    } else if (lower.includes('recharge') || lower.includes('रिचार्ज')) {
      transactionType = 'recharge';
      targetType = 'individual';
    }

    // 6. Extract Quantity (e.g. "10 kg", "10 kilo", "5 किलो", "1 cylinder")
    const qtyMatch = text.match(/(\d+)\s*(kg|kilo|किलो|ग्राम|gram|gm|लीटर|liter|l|कट्टा|बोरी|सिलेंडर|cylinder)/i);
    if (qtyMatch) {
      quantity = `${qtyMatch[1]} ${qtyMatch[2]}`;
    }

    // 7. Extract Amount (Numbers)
    // Matches numbers like 500, 1000, 299, 1250 or words
    const numMatches = text.match(/\b(\d{2,6})\b/g);
    if (numMatches && numMatches.length > 0) {
      // Pick the likely amount (usually the largest number or explicitly near 'rupaye/rs/rupees')
      const amountRegex = /(\d+)\s*(rupaye|rupee|rupees|रुपए|रुपये|rs|₹)/i;
      const explicitMatch = text.match(amountRegex);
      if (explicitMatch) {
        amount = parseInt(explicitMatch[1], 10);
      } else {
        // If no explicit rupee suffix, take the last number or first reasonable currency number
        amount = parseInt(numMatches[numMatches.length - 1], 10);
      }
    }

    // If still no trade detected, default to first trade
    if (!detectedTrade && trades.length > 0) {
      detectedTrade = trades[0];
    }

    return {
      rawText: text,
      tradeId: detectedTrade ? detectedTrade.id : '',
      workerId: detectedWorker ? detectedWorker.id : '',
      targetType: targetType,
      type: transactionType,
      rationItem: rationItem,
      quantity: quantity,
      amount: amount,
      role: role,
      note: text
    };
  }
}
