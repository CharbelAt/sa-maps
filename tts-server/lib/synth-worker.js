// Worker thread that owns the Kokoro model. ONNX Runtime's Node binding runs inference
// synchronously, so rendering on the main thread would freeze the HTTP server (cached clips
// and /health included) for the length of every render. Here it only blocks this thread.
import { parentPort, workerData } from 'node:worker_threads';
import { loadKokoro, synthesizeWav } from './engine.js';

const log = (msg) => parentPort.postMessage({ type: 'log', msg });
const tts = await loadKokoro({ modelDir: workerData.modelDir, dtype: workerData.dtype, log });
parentPort.postMessage({ type: 'ready' });

parentPort.on('message', async (m) => {
  if (m?.type !== 'render') return;
  try {
    const buf = await synthesizeWav(tts, m.text, m.params);
    // Buffer.alloc() never uses the shared pool, so the whole ArrayBuffer can be transferred.
    parentPort.postMessage({ type: 'result', id: m.id, ok: true, buf }, [buf.buffer]);
  } catch (e) {
    parentPort.postMessage({ type: 'result', id: m.id, ok: false, error: String(e?.message || e) });
  }
});
