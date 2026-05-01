// src/helpers/getReading.ts
import { breathalyser } from '../features/breathalyser';

/**
 * Sends the SCAN command to the connected Arduino device and waits
 * for a BAC result. This is the ONLY listener for BAC: messages.
 *
 * @returns {Promise<{ bac: number; timestamp: number }>}
 */
export async function getReading(): Promise<{ bac: number; timestamp: number }> {
  const connected = await breathalyser.isStillConnected();
  if (!connected) {
    throw new Error('Device is not connected');
  }

  await breathalyser.sendCommand('SCAN');

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsub();
      reject(new Error('Reading timed out (no BAC received after 25 seconds)'));
    }, 25000);

    const unsub = breathalyser.on((event) => {
      if (event.type === 'reading') {
        const msg = event.value.trim();
        if (msg.startsWith('BAC:')) {
          clearTimeout(timeout);
          unsub();

          const bacStr = msg.substring(4);
          const bac = parseFloat(bacStr);
          if (isNaN(bac)) {
            reject(new Error(`Invalid BAC value received: ${bacStr}`));
            return;
          }

          resolve({ bac, timestamp: Date.now() });
        }
      }
    });
  });
}