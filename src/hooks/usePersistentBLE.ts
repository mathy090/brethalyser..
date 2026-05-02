/**
 * src/hooks/usePersistentBLE.ts
 */
import { useEffect, useCallback, useState } from 'react';
import { breathalyser } from '../features/breathalyser';

export const usePersistentBLE = () => {
  // We keep this state but don't use it for auto-connect on mount anymore
  const [autoReconnectEnabled, setAutoReconnectEnabled] = useState(false); 

  const tryReconnect = useCallback(async () => {
    const lastId = await breathalyser.getLastConnectedDeviceId();
    if (!lastId) return;
    await breathalyser.connect({ id: lastId });
  }, []);

  // Modified: Do NOT auto-connect on mount
  const autoConnectOnMount = useCallback(async () => {
    // Intentionally empty or removed logic to prevent auto-reconnect
    console.log("Auto-connect disabled. Waiting for user interaction.");
  }, []);

  useEffect(() => {
    // No longer calling autoConnectOnMount
  }, []);

  return {
    autoConnectOnMount,
    handleManualDisconnect: async () => {
      setAutoReconnectEnabled(false);
      await breathalyser.disconnect();
    },
  };
};