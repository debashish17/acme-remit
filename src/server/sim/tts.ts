import {
  PollyClient,
  SynthesizeSpeechCommand,
  type Engine,
  type LanguageCode,
  type VoiceId,
} from "@aws-sdk/client-polly";

/**
 * POST /sim/speak: the assistant's voice from Amazon Polly (neural, Indian English by default),
 * the same on every browser, with word timings so the page highlights the read-back as it is
 * spoken. Two Polly requests per reply (audio and speech marks), both billed per character, so
 * replies are cached and a daily character cap keeps a public URL from running up the bill. The
 * page falls back to the browser's own voice whenever this fails.
 */

/** One spoken word: when it starts (ms into the audio) and where it is in the text (UTF-16). */
export interface SpeechMark {
  time: number;
  start: number;
  end: number;
  value: string;
}

export interface Speech {
  /** MP3, base64. */
  audio: string;
  marks: SpeechMark[];
  voice: string;
  engine: string;
}

/** Audio bytes and the raw speech-marks JSON lines Polly returns for `text`. */
export type Synthesize = (text: string) => Promise<{ audio: Uint8Array; marks: string }>;

export function pollySynthesize(opts: {
  region: string;
  voice: string;
  engine: string;
  languageCode?: string;
}): Synthesize {
  const client = new PollyClient({ region: opts.region, maxAttempts: 2 });
  const base = {
    VoiceId: opts.voice as VoiceId,
    Engine: opts.engine as Engine,
    // Kajal speaks Indian English and Hindi; the language code keeps it on English.
    LanguageCode: (opts.languageCode ?? "en-IN") as LanguageCode,
  };
  const request = async (text: string, format: "mp3" | "json") => {
    const out = await client.send(
      new SynthesizeSpeechCommand({
        ...base,
        Text: text,
        OutputFormat: format,
        ...(format === "json" ? { SpeechMarkTypes: ["word"] } : { SampleRate: "24000" }),
      }),
    );
    if (!out.AudioStream) throw new Error(`Polly returned no ${format} stream`);
    return out.AudioStream.transformToByteArray();
  };
  return async (text) => {
    const [audio, marks] = await Promise.all([request(text, "mp3"), request(text, "json")]);
    return { audio, marks: new TextDecoder().decode(marks) };
  };
}

/**
 * Polly's speech marks give UTF-8 byte offsets; the page indexes the text in UTF-16. Returns a
 * function from a byte offset to the string index of the character that contains it.
 */
export function byteToIndex(text: string): (byte: number) => number {
  const starts: number[] = []; // UTF-8 byte offset where each UTF-16 unit's character starts
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i) ?? 0;
    starts.push(bytes);
    if (cp > 0xffff) {
      starts.push(bytes); // the low surrogate belongs to the same character
      i++;
    }
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  starts.push(bytes); // an end offset can point just past the last character
  return (byte) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] ?? 0) <= byte) lo = mid;
      else hi = mid - 1;
    }
    // Both halves of a surrogate pair share an offset: answer with the first.
    while (lo > 0 && starts[lo - 1] === starts[lo]) lo--;
    return lo;
  };
}

export function parseMarks(text: string, jsonLines: string): SpeechMark[] {
  const at = byteToIndex(text);
  return jsonLines
    .split("\n")
    .filter((l) => l.trim())
    .map(
      (l) =>
        JSON.parse(l) as { time: number; type: string; start: number; end: number; value: string },
    )
    .filter((m) => m.type === "word")
    .map((m) => ({ time: m.time, start: at(m.start), end: at(m.end), value: m.value }));
}

export interface TtsOptions {
  synthesize: Synthesize;
  voice: string;
  engine: string;
  /** Characters Polly may bill per UTC day (each reply bills its length twice). */
  dailyChars: number;
  cacheSize?: number;
  now?: () => Date;
}

export class TtsService {
  private readonly cache = new Map<string, Speech>();
  private day = "";
  private used = 0;

  constructor(private readonly opts: TtsOptions) {}

  get voice(): { voice: string; engine: string } {
    return { voice: this.opts.voice, engine: this.opts.engine };
  }

  /** Speech for `text`, from the cache when possible; null once today's character cap is used. */
  async speak(text: string): Promise<Speech | null> {
    const hit = this.cache.get(text);
    if (hit) {
      this.cache.delete(text); // refresh its place in the LRU order
      this.cache.set(text, hit);
      return hit;
    }
    const today = (this.opts.now?.() ?? new Date()).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
    const billed = text.length * 2; // audio and speech marks are separate billed requests
    if (this.used + billed > this.opts.dailyChars) return null;
    this.used += billed;

    let raw: Awaited<ReturnType<Synthesize>>;
    try {
      raw = await this.opts.synthesize(text);
    } catch (err) {
      this.used -= billed; // a failed request is not billed, so it doesn't count against the cap
      throw err;
    }
    const speech: Speech = {
      audio: Buffer.from(raw.audio).toString("base64"),
      marks: parseMarks(text, raw.marks),
      ...this.voice,
    };
    this.cache.set(text, speech);
    const max = this.opts.cacheSize ?? 50;
    while (this.cache.size > max) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return speech;
  }

  get charsLeftToday(): number {
    return Math.max(0, this.opts.dailyChars - this.used);
  }
}
