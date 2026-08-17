'use strict';

(() => {
  const VERSION = '0.6.2';
  const nativeFetch = window.fetch.bind(window);
  const NativeAudio = window.Audio;
  let pendingVoiceText = '';
  let lastVoiceEndedAt = 0;

  function emit(name, detail = {}) {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  }

  // Capture the text being sent to our own RoadCast voice function so the
  // hands-free layer knows exactly what RoadCast just said.
  window.fetch = async function(input, init = {}) {
    try {
      const url = typeof input === 'string' ? input : String(input?.url || '');
      if (url.includes('/functions/v1/roadcast-voice')) {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
        pendingVoiceText = String(body?.text || '').replace(/<break\s+time=\"[^\"]+\"\s*\/>/gi, '').trim();
      }
    } catch {}
    return nativeFetch(input, init);
  };

  // Android/car audio systems can take a fraction of a second to wake after
  // silence. Pre-roll the same clip at nearly-zero volume, rewind it, then
  // play it normally. This protects the first spoken word without changing
  // the generated ElevenLabs audio.
  window.Audio = function(src) {
    const el = new NativeAudio(src);
    const text = pendingVoiceText;
    pendingVoiceText = '';

    if (!text) return el;

    el.__roadcastText = text;
    const nativePlay = el.play.bind(el);
    let primed = false;
    let audibleStarted = false;

    el.play = async function() {
      if (!primed) {
        primed = true;
        const originalVolume = Number.isFinite(el.volume) ? el.volume : 1;
        const quietGap = Date.now() - lastVoiceEndedAt;
        const warmMs = quietGap > 4500 ? 180 : 90;

        try {
          el.volume = Math.min(originalVolume, 0.002);
          await nativePlay();
          await new Promise(resolve => setTimeout(resolve, warmMs));
          el.pause();
          try { el.currentTime = 0; } catch {}
          await new Promise(resolve => setTimeout(resolve, 70));
        } catch (err) {
          console.warn('RoadCast audio pre-roll skipped.', err);
          try { el.pause(); el.currentTime = 0; } catch {}
        } finally {
          el.volume = originalVolume;
        }
      }

      if (!audibleStarted) {
        audibleStarted = true;
        emit('roadcast:speechstart', { text, mode: 'myvoice' });
      }

      return nativePlay();
    };

    el.addEventListener('ended', () => {
      lastVoiceEndedAt = Date.now();
      emit('roadcast:speechend', { text, mode: 'myvoice' });
    });

    return el;
  };
  window.Audio.prototype = NativeAudio.prototype;

  // Also expose start/end events if RoadCast ever falls back to the phone's
  // built-in speech engine.
  if (window.speechSynthesis?.speak) {
    const nativeSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak = function(utterance) {
      const text = String(utterance?.text || '').trim();
      const originalStart = utterance.onstart;
      const originalEnd = utterance.onend;
      const originalError = utterance.onerror;

      utterance.onstart = function(event) {
        emit('roadcast:speechstart', { text, mode: 'standard' });
        if (typeof originalStart === 'function') originalStart.call(this, event);
      };
      utterance.onend = function(event) {
        lastVoiceEndedAt = Date.now();
        emit('roadcast:speechend', { text, mode: 'standard' });
        if (typeof originalEnd === 'function') originalEnd.call(this, event);
      };
      utterance.onerror = function(event) {
        lastVoiceEndedAt = Date.now();
        emit('roadcast:speechend', { text, mode: 'standard', error: true });
        if (typeof originalError === 'function') originalError.call(this, event);
      };

      return nativeSpeak(utterance);
    };
  }

  console.info(`RoadCast SSML audio wake-up protection ${VERSION} loaded.`);
})();
