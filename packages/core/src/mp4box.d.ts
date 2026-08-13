/**
 * Type declarations for mp4box (v2.x)
 * Minimal subset used by @hevcjs/core
 */
declare module "mp4box" {
  interface MP4BoxFile {
    onReady: ((info: MP4Info) => void) | null;
    onSamples: ((trackId: number, user: unknown, samples: MP4Sample[]) => void) | null;
    onError: ((error: Error) => void) | null;

    appendBuffer(buffer: ArrayBufferWithStart): number;
    start(): void;
    stop(): void;
    flush(): void;

    setExtractionOptions(trackId: number, user?: unknown, options?: { nbSamples?: number }): void;
    unsetExtractionOptions(trackId: number): void;

    getTrackById(trackId: number): MP4BoxTrack | null;
  }

  interface ArrayBufferWithStart extends ArrayBuffer {
    fileStart: number;
  }

  interface MP4Info {
    duration: number;
    timescale: number;
    isFragmented: boolean;
    isProgressive: boolean;
    hasIOD: boolean;
    brands: string[];
    tracks: MP4Track[];
    videoTracks: MP4Track[];
    audioTracks: MP4Track[];
  }

  interface MP4Track {
    id: number;
    type: string;
    codec: string;
    language: string;
    timescale: number;
    duration: number;
    nb_samples: number;
    size: number;
    bitrate: number;
    width?: number;
    height?: number;
    audio_sample_rate?: number;
    audio_channel_count?: number;
    video?: {
      width: number;
      height: number;
    };
    audio?: {
      sample_rate: number;
      channel_count: number;
      sample_size: number;
    };
  }

  interface MP4BoxTrack {
    id: number;
    trak: unknown;
    samples: MP4Sample[];
  }

  interface MP4Sample {
    number: number;
    track_id: number;
    description: MP4SampleDescription;
    is_rap: boolean;
    is_sync: boolean;
    timescale: number;
    dts: number;
    cts: number;
    duration: number;
    size: number;
    data: ArrayBuffer;
  }

  interface MP4SampleDescription {
    type: string;
    avcC?: ArrayBuffer;
    hvcC?: ArrayBuffer;
    width?: number;
    height?: number;
  }

  export function createFile(keepMdatData?: boolean): MP4BoxFile;

  export const Log: {
    setLogLevel(level: number): void;
    info: number;
    warn: number;
    error: number;
    debug: number;
  };
}
