/**
 * Where the fields of the WASM module's `HEVCFrame` struct sit.
 *
 * The module reports them itself, through `hevc_frame_layout()`: five readers
 * walk a frame in its memory — this package's decoder and worker, and the
 * unbundled `hevc_decoder.js`, `worker.js` and `wasm_decode.cjs` — and three of
 * them cannot import anything, so hardcoding the offsets duplicated them by
 * construction (#370). What each reader hardcodes now is the field names, and a
 * name the module does not report throws instead of reading `undefined`.
 */
export interface FrameLayout {
  /** Byte offset of each field, by its name in the C struct. */
  readonly offset: Readonly<Record<FrameField, number>>;
  /** `sizeof(HEVCFrame)`, to allocate one. */
  readonly size: number;
}

export type FrameField =
  | "y"
  | "cb"
  | "cr"
  | "width"
  | "height"
  | "stride_y"
  | "stride_c"
  | "chroma_width"
  | "chroma_height"
  | "bit_depth"
  | "poc"
  | "cvs_id"
  | "bytes_per_sample";

const FIELDS: readonly FrameField[] = [
  "y",
  "cb",
  "cr",
  "width",
  "height",
  "stride_y",
  "stride_c",
  "chroma_width",
  "chroma_height",
  "bit_depth",
  "poc",
  "cvs_id",
  "bytes_per_sample",
];

/**
 * Parse what `hevc_frame_layout()` returns: `name:offset` pairs separated by
 * commas, with `_size` for the struct's size.
 *
 * @throws if a field this package reads is missing, or an offset is not a
 * number — a frame read against a partial layout would produce plausible
 * pixels rather than an error.
 */
export function parseFrameLayout(spec: string): FrameLayout {
  const parsed = new Map<string, number>();
  for (const field of spec.split(",")) {
    const sep = field.indexOf(":");
    if (sep < 0) throw new Error(`HEVCFrame layout: malformed field ${JSON.stringify(field)}`);
    const name = field.slice(0, sep);
    const value = Number(field.slice(sep + 1));
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`HEVCFrame layout: ${name} is not a byte offset (${field})`);
    }
    parsed.set(name, value);
  }

  const offset = {} as Record<FrameField, number>;
  for (const name of FIELDS) {
    const value = parsed.get(name);
    if (value === undefined) throw new Error(`HEVCFrame layout: missing ${name}`);
    offset[name] = value;
  }
  const size = parsed.get("_size");
  if (size === undefined) throw new Error("HEVCFrame layout: missing _size");

  return { offset, size };
}
