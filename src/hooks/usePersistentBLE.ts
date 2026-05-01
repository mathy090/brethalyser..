/**
 * src/hooks/usePersistentBLE.ts
 */
import { useEffect, useCallback, useState } from 'react';
import { breathalyser } from '../features/breathalyser';

export const usePersistentBLE = () => {
  const [autoReconnectEnabled, setAutoReconnectEnabled] = useState(true);

  const tryReconnect = useCallback(async () => {
    const lastId = await breathalyser.getLastConnectedDeviceId();
    if (!lastId) return;
    
    await breathalyser.connect({ id: lastId });
  }, []);

  const autoConnectOnMount = useCallback(async () => {
    if (!autoReconnectEnabled) return;
    try {
      await tryReconnect();
    } catch {
      setAutoReconnectEnabled(false);
    }
  }, [autoReconnectEnabled, tryReconnect]);

  useEffect(() => {
    // ✅ Removed initialize() - it's now global
    autoConnectOnMount();
  }, [autoConnectOnMount]);

  return {
    autoConnectOnMount,
    handleManualDisconnect: async () => {
      setAutoReconnectEnabled(false);
      await breathalyser.disconnect();
    },
  };
};