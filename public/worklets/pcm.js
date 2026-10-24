// AudioWorklet for lib/client/recorder.ts: batches mono Float32 input (the context's native rate) into
// ~2048-sample chunks and posts them to the main thread, which downsamples to 16 kHz PCM16.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(2048);
    this.n = 0;
    this.port.onmessage = (e) => {
      if (e.data === "flush" && this.n > 0) {
        this.port.postMessage(this.buf.slice(0, this.n));
        this.n = 0;
      }
    };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf.slice(0));
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
