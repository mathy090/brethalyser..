import React, {
  createContext, useContext, useEffect,
  useState, useCallback, useRef,
} from "react";
import { breathalyser, type DeviceStatus, type BACResult } from "../features/breathalyser";

interface BreathalyserContextType {
  status:        DeviceStatus;
  result:        BACResult | null;
  history:       BACResult[];
  errorMsg:      string;
  recalMsg:      string;
  battery:       number;
  isConnected:   boolean;
  connectedName: string;
  requestScan:   () => Promise<void>;
  clearResult:   () => void;
}

const BreathalyserContext = createContext<BreathalyserContextType>({
  status:        "disconnected",
  result:        null,
  history:       [],
  errorMsg:      "",
  recalMsg:      "",
  battery:       0,
  isConnected:   false,
  connectedName: "",
  requestScan:   async () => {},
  clearResult:   () => {},
});

export const useBreathalyser = () => useContext(BreathalyserContext);

export function BreathalyserProvider({ children }: { children: React.ReactNode }) {
  const [status,        setStatus]        = useState<DeviceStatus>("disconnected");
  const [result,        setResult]        = useState<BACResult | null>(null);
  const [history,       setHistory]       = useState<BACResult[]>([]);
  const [errorMsg,      setErrorMsg]      = useState("");
  const [recalMsg,      setRecalMsg]      = useState("");
  const [battery,       setBattery]       = useState(0);
  const [connectedName, setConnectedName] = useState("");
  const recalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = breathalyser.on((event) => {
      switch (event.type) {
        case "status":
          setStatus(event.status);
          if (event.status !== "error") setErrorMsg("");
          if (event.status === "connected")    setConnectedName(breathalyser.getConnectedDeviceName());
          if (event.status === "disconnected") setConnectedName("");
          break;
        case "result":
          setResult(event.result);
          setHistory(prev => [event.result, ...prev].slice(0, 20));
          setRecalMsg("");
          break;
        case "battery":
          setBattery(event.level);
          break;
        case "recal":
          setRecalMsg("Sensor elevated — recalibrating…");
          break;
        case "stable":
          setRecalMsg("Recalibration complete.");
          if (recalTimer.current) clearTimeout(recalTimer.current);
          recalTimer.current = setTimeout(() => setRecalMsg(""), 3000);
          break;
        case "error":
          setErrorMsg(event.message);
          break;
        case "scan_result":
          break;
      }
    });
    return () => {
      unsub();
      if (recalTimer.current) clearTimeout(recalTimer.current);
    };
  }, []);

  const requestScan = useCallback(async () => {
    if (!breathalyser.isConnected()) {
      setErrorMsg("No device connected. Go to Breathalyser tab.");
      return;
    }
    if (status !== "ready") return;
    setResult(null);
    setErrorMsg("");
    await breathalyser.requestScan();
  }, [status]);

  const clearResult = useCallback(() => {
    setResult(null);
    setErrorMsg("");
  }, []);

  return (
    <BreathalyserContext.Provider value={{
      status, result, history, errorMsg, recalMsg, battery,
      isConnected:   breathalyser.isConnected(),
      connectedName, requestScan, clearResult,
    }}>
      {children}
    </BreathalyserContext.Provider>
  );
}