import NetInfo, { NetInfoState } from "@react-native-community/netinfo";
import { useEffect, useState } from "react";

export const useNetworkStatus = () => {
  const [isConnected, setIsConnected] = useState<boolean>(true);
  const [connectionType, setConnectionType] = useState<string>("unknown");

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      setIsConnected(state.isConnected ?? false);
      setConnectionType(state.type);
    });
    return () => unsubscribe();
  }, []);

  return { isConnected, connectionType };
};

export const checkConnection = async (): Promise<boolean> => {
  const state = await NetInfo.fetch();
  return state.isConnected ?? false;
};