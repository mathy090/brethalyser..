/**
 * Debug utilities for manual BLE testing
 * Import and call these from your app's debug console or a test screen
 */

import { breathalyser } from '../features/breathalyser';

export const debugBLE = {
  /**
   * Print current BLE state to console
   */
  async printState() {
    console.log("🔍 === BLE DEBUG INFO ===");
    const info = await breathalyser.getDebugInfo();
    console.table(info);
    console.log("🔍 ======================");
    return info;
  },

  /**
   * Test sending a command and logging the raw response
   */
  async testCommand(cmd: string, timeoutMs = 10000) {
    console.log(`🧪 Testing command: "${cmd}"`);
    
    if (!await breathalyser.isStillConnected()) {
      console.error("❌ Not connected");
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsub();
        console.error("⏱️ Command test timed out");
        reject(new Error("Timeout"));
      }, timeoutMs);

      const unsub = breathalyser.on((event) => {
        if (event.type === 'reading') {
          console.log("✅ Received response:", event.value);
          clearTimeout(timeout);
          unsub();
          resolve();
        }
      });

      breathalyser.sendCommand(cmd).catch(err => {
        clearTimeout(timeout);
        unsub();
        reject(err);
      });
    });
  },

  /**
   * Force-emit a fake reading for UI testing (no Arduino needed)
   */
  simulateReading(bac: number = 0.05) {
    console.log(`🎭 Simulating BAC reading: ${bac}`);
    breathalyser.emit({ 
      type: 'reading', 
      value: `BAC:${bac.toFixed(2)}\nSTATUS:READY` 
    });
  },

  /**
   * List all active event listeners (for leak detection)
   */
  checkListeners() {
    // This requires exposing listener count in breathalyser module
    console.log("👥 Listener check: See breathalyser.getDebugInfo() for count");
  }
};

// Usage example (call from your app):
// import { debugBLE } from './utils/debugBLE';
// debugBLE.printState();
// debugBLE.testCommand('SCAN');
// debugBLE.simulateReading(0.08);