// Web Audio API Sound Synthesizer - Fortune Tiger Clone (KASSINO-CKB)

class AudioManager {
  private ctx: AudioContext | null = null;
  private muted = false;

  private initCtx() {
    if (!this.ctx && typeof window !== "undefined") {
      // Initialize AudioContext
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        this.ctx = new AudioContextClass();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
    
  }

  isMuted() {
    return this.muted;
  }

  playSpin() {
    if (this.muted) return;
    this.initCtx();
    if (!this.ctx) return;

    // A brief synthesized sliding tone for spinning
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, this.ctx.currentTime + 0.35);

    gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.35);
  }

  playStop(pitchFactor = 1.0) {
    if (this.muted) return;
    this.initCtx();
    if (!this.ctx) return;

    // A short punchy beep for stopping
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(250 * pitchFactor, this.ctx.currentTime);

    gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.08);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.08);
  }

  playWin() {
    if (this.muted) return;
    this.initCtx();
    if (!this.ctx) return;

    // Rising arpeggio of notes
    const now = this.ctx.currentTime;
    const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99]; // C major chord
    
    notes.forEach((freq, index) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();

      osc.type = "triangle";
      osc.frequency.value = freq;

      const startTime = now + index * 0.08;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.15, startTime + 0.02);
      gain.gain.linearRampToValueAtTime(0.001, startTime + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx!.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.25);
    });
  }

  playBigWin() {
    if (this.muted) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const notes = [392.00, 523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98]; // Energetic major scale notes
    
    // Play a repeating celebratory siren/chime
    for (let r = 0; r < 3; r++) {
      const roundDelay = r * 0.4;
      notes.forEach((freq, index) => {
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + roundDelay + index * 0.05);

        const startTime = now + roundDelay + index * 0.05;
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.2, startTime + 0.02);
        gain.gain.linearRampToValueAtTime(0.001, startTime + 0.18);

        osc.connect(gain);
        gain.connect(this.ctx!.destination);

        osc.start(startTime);
        osc.stop(startTime + 0.18);
      });
    }
  }

  playFeatureTrigger() {
    if (this.muted) return;
    this.initCtx();
    if (!this.ctx) return;

    // Intense alarm sound followed by low growl synth
    const now = this.ctx.currentTime;
    
    // 1. Alert alarms
    for (let i = 0; i < 4; i++) {
      const startTime = now + i * 0.15;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(600, startTime);
      osc.frequency.linearRampToValueAtTime(900, startTime + 0.12);

      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.18, startTime + 0.03);
      gain.gain.linearRampToValueAtTime(0.001, startTime + 0.12);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.12);
    }

    // 2. Tiger roar Growl synthesis
    const growlTime = now + 0.6;
    const oscG = this.ctx.createOscillator();
    const gainG = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    oscG.type = "sawtooth";
    oscG.frequency.setValueAtTime(95, growlTime);
    // Add frequency modulation for vibration
    oscG.frequency.linearRampToValueAtTime(60, growlTime + 0.8);

    filter.type = "peaking";
    filter.frequency.setValueAtTime(120, growlTime);
    filter.Q.setValueAtTime(8, growlTime);

    gainG.gain.setValueAtTime(0, growlTime);
    gainG.gain.linearRampToValueAtTime(0.25, growlTime + 0.15);
    gainG.gain.exponentialRampToValueAtTime(0.001, growlTime + 0.8);

    oscG.connect(filter);
    filter.connect(gainG);
    gainG.connect(this.ctx.destination);

    oscG.start(growlTime);
    oscG.stop(growlTime + 0.8);
  }
}

export const gameAudio = new AudioManager();
