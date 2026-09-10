import { fingerprints, alignFeatures } from '../lib/alignment.mjs';
self.onmessage = (event) => {
  try {
    const { a, b, rate, matchSeconds } = event.data;
    self.postMessage({
      result: alignFeatures(
        fingerprints(a, rate),
        fingerprints(b, rate),
        matchSeconds,
      ),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
