type SoundName =
  | 'click'
  | 'queue'
  | 'mine_start'
  | 'mine'
  | 'lift_start'
  | 'lift'
  | 'truck_start'
  | 'truck'
  | 'sale'
  | 'upgrade'
  | 'tier_up'
  | 'unlock'
  | 'reward'
  | 'error';

interface SoundPreset {
  frequencies: number[];
  duration: number;
  type: OscillatorType;
  gain: number;
  cooldown?: number;
  noise?: number;
  endFrequency?: number;
}

interface MusicPattern {
  name: string;
  roots: readonly number[];
  melody: readonly number[];
  leadType: OscillatorType;
  tempo: number;
}

const MUSIC_PATTERNS: readonly MusicPattern[] = [
  {
    name: '浅层班次',
    roots: [130.81, 146.83, 174.61, 130.81],
    melody: [261.63, 293.66, 349.23, 392, 329.63, 293.66, 261.63, 196],
    leadType: 'triangle',
    tempo: 0.4,
  },
  {
    name: '深井回声',
    roots: [110, 98, 87.31, 116.54],
    melody: [220, 261.63, 196, 174.61, 146.83, 174.61, 196, 220],
    leadType: 'sine',
    tempo: 0.44,
  },
  {
    name: '矿脉微光',
    roots: [155.56, 174.61, 196, 146.83],
    melody: [311.13, 349.23, 392, 466.16, 392, 349.23, 311.13, 261.63],
    leadType: 'triangle',
    tempo: 0.38,
  },
  {
    name: '夜班地心',
    roots: [82.41, 98, 110, 92.5],
    melody: [164.81, 196, 220, 246.94, 220, 196, 174.61, 146.83],
    leadType: 'sine',
    tempo: 0.46,
  },
];

export class SfxEngine {
  private context: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private enabled = true;
  private musicEnabled = true;
  private sfxVolume = 0.75;
  private musicVolume = 0.65;
  private vibrationEnabled = true;
  private lastPlayed = new Map<SoundName, number>();
  private lastProductionAt = -Infinity;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private musicPattern = 0;
  private nextMusicTime = 0;
  private musicSources = new Set<AudioScheduledSourceNode>();
  private musicNoiseBuffer: AudioBuffer | null = null;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setVibrationEnabled(enabled: boolean): void {
    this.vibrationEnabled = enabled;
  }

  getDebugState(): {
    contextState: AudioContextState | 'none';
    musicEnabled: boolean;
    musicScheduled: boolean;
    musicTrack: string;
    sfxVolume: number;
    musicVolume: number;
  } {
    return {
      contextState: this.context?.state ?? 'none',
      musicEnabled: this.musicEnabled,
      musicScheduled: this.musicTimer !== null,
      musicTrack: MUSIC_PATTERNS[this.musicPattern]?.name ?? '',
      sfxVolume: this.sfxVolume,
      musicVolume: this.musicVolume,
    };
  }

  setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    if (!enabled) {
      this.stopMusic();
      return;
    }
    if (this.context) {
      if (this.context.state === 'suspended') {
        void this.context.resume().then(() => {
          if (this.musicEnabled) this.startMusic();
        });
      } else {
        this.startMusic();
      }
    }
  }

  setSfxVolume(volume: number): void {
    this.sfxVolume = Math.min(1, Math.max(0, volume));
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = Math.min(1, Math.max(0, volume));
  }

  unlock(): void {
    if (this.context) {
      if (
        this.musicEnabled &&
        this.musicTimer === null &&
        this.context.state === 'running'
      ) {
        this.startMusic();
      }
      return;
    }
    const Context = window.AudioContext;
    if (Context) {
      this.context = new Context();
      this.ensureAudioGraph(this.context);
      void this.context.resume().then(() => {
        if (this.musicEnabled) this.startMusic();
      });
    }
  }

  play(name: SoundName): void {
    this.unlock();
    if (!this.enabled) return;
    const context = this.context;
    if (!context) return;
    if (context.state === 'suspended') void context.resume();

    const presets: Record<SoundName, SoundPreset> = {
      click: {
        frequencies: [250],
        duration: 0.035,
        type: 'square',
        gain: 0.008,
        cooldown: 45,
      },
      queue: {
        frequencies: [185, 265],
        duration: 0.065,
        type: 'triangle',
        gain: 0.015,
        cooldown: 35,
      },
      mine_start: {
        frequencies: [82],
        duration: 0.11,
        type: 'sawtooth',
        gain: 0.014,
        cooldown: 650,
        endFrequency: 58,
      },
      mine: {
        frequencies: [112, 78],
        duration: 0.085,
        type: 'square',
        gain: 0.015,
        cooldown: 700,
        noise: 0.01,
        endFrequency: 54,
      },
      lift_start: {
        frequencies: [126, 176],
        duration: 0.13,
        type: 'triangle',
        gain: 0.013,
        cooldown: 700,
        endFrequency: 205,
      },
      lift: {
        frequencies: [176, 238, 316],
        duration: 0.1,
        type: 'triangle',
        gain: 0.014,
        cooldown: 650,
      },
      truck_start: {
        frequencies: [58, 74],
        duration: 0.18,
        type: 'sawtooth',
        gain: 0.013,
        cooldown: 750,
        noise: 0.008,
        endFrequency: 67,
      },
      truck: {
        frequencies: [62],
        duration: 0.1,
        type: 'sawtooth',
        gain: 0.009,
        cooldown: 800,
        noise: 0.005,
      },
      sale: {
        frequencies: [523, 659, 784, 1047],
        duration: 0.12,
        type: 'triangle',
        gain: 0.022,
        cooldown: 480,
      },
      upgrade: {
        frequencies: [330, 494, 740],
        duration: 0.17,
        type: 'triangle',
        gain: 0.032,
        cooldown: 100,
      },
      tier_up: {
        frequencies: [392, 523, 659, 880, 1175],
        duration: 0.18,
        type: 'square',
        gain: 0.024,
        cooldown: 300,
      },
      unlock: {
        frequencies: [294, 392, 523, 784],
        duration: 0.16,
        type: 'square',
        gain: 0.027,
        cooldown: 250,
      },
      reward: {
        frequencies: [392, 523, 659, 784],
        duration: 0.16,
        type: 'square',
        gain: 0.026,
        cooldown: 250,
      },
      error: {
        frequencies: [120, 88],
        duration: 0.1,
        type: 'sawtooth',
        gain: 0.016,
        cooldown: 120,
        endFrequency: 72,
      },
    };

    const preset = presets[name];
    const realNow = performance.now();
    const last = this.lastPlayed.get(name) ?? -Infinity;
    if (realNow - last < (preset.cooldown ?? 0)) return;
    const productionSound =
      name === 'mine_start' ||
      name === 'mine' ||
      name === 'lift_start' ||
      name === 'lift' ||
      name === 'truck_start' ||
      name === 'truck' ||
      name === 'sale';
    if (productionSound && realNow - this.lastProductionAt < 220) return;
    this.lastPlayed.set(name, realNow);
    if (productionSound) this.lastProductionAt = realNow;

    const now = context.currentTime;
    preset.frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + index * preset.duration * 0.4;
      const end = start + preset.duration * (index === preset.frequencies.length - 1 ? 1 : 0.72);
      oscillator.type = preset.type;
      oscillator.frequency.setValueAtTime(frequency, start);
      if (preset.endFrequency) {
        oscillator.frequency.exponentialRampToValueAtTime(
          Math.max(20, preset.endFrequency),
          end,
        );
      }
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.0001, preset.gain * 4.2 * this.effectiveSfxVolume()),
        start + 0.008,
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(gain);
      gain.connect(this.sfxBus ?? context.destination);
      oscillator.start(start);
      oscillator.stop(end + 0.01);
    });

    if (preset.noise) this.playNoise(context, now, preset.duration, preset.noise);
  }

  vibrate(pattern: number | number[]): void {
    if (!this.vibrationEnabled || !('vibrate' in navigator)) return;
    navigator.vibrate(pattern);
  }

  private startMusic(): void {
    const context = this.context;
    if (!context || !this.musicEnabled || this.musicTimer !== null) return;
    if (context.state === 'suspended') {
      void context.resume().then(() => {
        if (this.musicEnabled) this.startMusic();
      });
      return;
    }
    this.musicStep = 0;
    this.musicPattern = 0;
    this.nextMusicTime = context.currentTime + 0.08;
    this.scheduleMusic();
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 240);
  }

  private stopMusic(): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    for (const source of this.musicSources) {
      try {
        source.stop();
      } catch {
        // Already stopped sources are harmless.
      }
    }
    this.musicSources.clear();
  }

  private scheduleMusic(): void {
    const context = this.context;
    if (!context || !this.musicEnabled) return;
    if (this.nextMusicTime < context.currentTime - 0.5) {
      this.nextMusicTime = context.currentTime + 0.08;
    }
    while (this.nextMusicTime < context.currentTime + 0.85) {
      const pattern = MUSIC_PATTERNS[this.musicPattern] ?? MUSIC_PATTERNS[0];
      this.scheduleMusicStep(
        this.musicPattern,
        this.musicStep,
        this.nextMusicTime,
      );
      this.nextMusicTime += pattern.tempo;
      this.musicStep += 1;
      if (this.musicStep >= 32) {
        this.musicStep = 0;
        this.musicPattern =
          (this.musicPattern + 1) % MUSIC_PATTERNS.length;
      }
    }
  }

  private scheduleMusicStep(
    patternIndex: number,
    step: number,
    start: number,
  ): void {
    const context = this.context;
    if (!context) return;
    const pattern = MUSIC_PATTERNS[patternIndex] ?? MUSIC_PATTERNS[0];
    const root =
      pattern.roots[Math.floor(step / 8) % pattern.roots.length] ??
      pattern.roots[0];

    if (step % 8 === 0) {
      this.scheduleTone(start, 2.75, root / 2, 0.018, 'triangle', 680);
      this.scheduleTone(start, 2.45, root, 0.009, 'sine', 520);
      this.scheduleTone(start, 2.45, root * 1.5, 0.0065, 'sine', 560);
    }

    if (step % 4 === 0) {
      this.scheduleTone(start, 0.34, root / 2, 0.011, 'triangle', 380);
    }

    if (step % 2 === 1) {
      const note =
        pattern.melody[(step + patternIndex * 3) % pattern.melody.length] ??
        pattern.melody[0];
      this.scheduleTone(
        start,
        pattern.leadType === 'sine' ? 0.3 : 0.22,
        note,
        0.012,
        pattern.leadType,
        1200,
      );
    }
    if (step === 2 || step === 10 || step === 18 || step === 26) {
      const highNote =
        pattern.melody[(step / 2 + 3) % pattern.melody.length] ??
        pattern.melody[0];
      this.scheduleTone(start, 0.42, highNote * 2, 0.0055, 'sine', 1700);
    }
    if (
      patternIndex >= 2 &&
      (step === 6 || step === 14 || step === 22 || step === 30)
    ) {
      this.scheduleTone(start, 0.28, root * 2, 0.0045, 'triangle', 1500);
    }

    if (step === 0 || step === 8) {
      this.playMusicNoise(start, 0.11, 0.012, 150);
    } else if (step === 16 || step === 24) {
      this.playMusicNoise(start, 0.08, 0.0085, 190);
    } else if (step === 4 || step === 12) {
      this.playMusicNoise(start, 0.07, 0.008, 260);
    }
  }

  private scheduleTone(
    start: number,
    duration: number,
    frequency: number,
    gainValue: number,
    type: OscillatorType,
    filterFrequency: number,
  ): void {
    const context = this.context;
    if (!context) return;
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFrequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, gainValue * this.effectiveMusicVolume()),
      start + 0.025,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicBus ?? context.destination);
    this.trackMusicSource(oscillator);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private playMusicNoise(
    start: number,
    duration: number,
    gainValue: number,
    cutoff: number,
  ): void {
    const context = this.context;
    if (!context) return;
    if (!this.musicNoiseBuffer) {
      const frames = Math.max(1, Math.floor(context.sampleRate * 0.12));
      this.musicNoiseBuffer = context.createBuffer(1, frames, context.sampleRate);
      const data = this.musicNoiseBuffer.getChannelData(0);
      for (let index = 0; index < frames; index += 1) {
        const envelope = Math.pow(1 - index / frames, 3);
        data[index] = (Math.random() * 2 - 1) * envelope;
      }
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, start);
    gain.gain.setValueAtTime(
      Math.max(0.0001, gainValue * 1.9 * this.effectiveMusicVolume()),
      start,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.buffer = this.musicNoiseBuffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicBus ?? context.destination);
    this.trackMusicSource(source);
    source.start(start);
    source.stop(start + duration + 0.01);
  }

  private trackMusicSource(source: AudioScheduledSourceNode): void {
    this.musicSources.add(source);
    source.addEventListener('ended', () => this.musicSources.delete(source), {
      once: true,
    });
  }

  private playNoise(
    context: AudioContext,
    start: number,
    duration: number,
    gainValue: number,
  ): void {
    const frames = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < frames; index += 1) {
      const envelope = 1 - index / frames;
      data[index] = (Math.random() * 2 - 1) * envelope;
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, start);
    gain.gain.setValueAtTime(
      Math.max(0.0001, gainValue * 3.5 * this.effectiveSfxVolume()),
      start,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus ?? context.destination);
    source.start(start);
    source.stop(start + duration);
  }

  private effectiveSfxVolume(): number {
    return Math.pow(this.sfxVolume, 1.05);
  }

  private effectiveMusicVolume(): number {
    return Math.pow(this.musicVolume, 1.05) * 1.05;
  }

  private ensureAudioGraph(context: AudioContext): void {
    if (this.sfxBus && this.musicBus && this.compressor) return;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-16, context.currentTime);
    compressor.knee.setValueAtTime(10, context.currentTime);
    compressor.ratio.setValueAtTime(6, context.currentTime);
    compressor.attack.setValueAtTime(0.003, context.currentTime);
    compressor.release.setValueAtTime(0.18, context.currentTime);

    const sfxBus = context.createGain();
    const musicBus = context.createGain();
    sfxBus.gain.setValueAtTime(1.45, context.currentTime);
    musicBus.gain.setValueAtTime(1.25, context.currentTime);
    sfxBus.connect(compressor);
    musicBus.connect(compressor);
    compressor.connect(context.destination);
    this.sfxBus = sfxBus;
    this.musicBus = musicBus;
    this.compressor = compressor;
  }
}
