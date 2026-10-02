export class FrameError extends Error {}

const HEADER_BYTES = 4;

export function encodeFrame(body: string | Buffer): Buffer {
  const payload = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export class FrameReader {
  private buffered: Buffer = Buffer.alloc(0);

  constructor(private readonly maxBytes: number) {}

  push(chunk: Buffer): Buffer[] {
    this.buffered = Buffer.concat([this.buffered, chunk]);
    const frames: Buffer[] = [];
    for (;;) {
      if (this.buffered.length < HEADER_BYTES) return frames;
      const length = this.buffered.readUInt32LE(0);
      if (length > this.maxBytes) {
        throw new FrameError(
          `A message of ${length} bytes is over the ${this.maxBytes} byte limit.`,
        );
      }
      if (this.buffered.length < HEADER_BYTES + length) return frames;
      frames.push(this.buffered.subarray(HEADER_BYTES, HEADER_BYTES + length));
      this.buffered = this.buffered.subarray(HEADER_BYTES + length);
    }
  }

  get pending(): number {
    return this.buffered.length;
  }
}
