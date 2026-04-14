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
  isAwaitingBac: boolean;       // true from SCAN sent → BAC received (loading state)
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
  isAwaitingBac: false,
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
  const [isConnected,   setIsConnected]   = useState(false);
  // isAwaitingBac: set true when SCAN is sent, cleared when result or error arrives
  const [isAwaitingBac, setIsAwaitingBac] = useState(false);

  const recalTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const awaitingRef = useRef(false); // shadow ref so event handler closure is always fresh

  useEffect(() => {
    const unsub = breathalyser.on((event) => {
      switch (event.type) {

        case "status":
          setStatus(event.status);

          if (event.status !== "error") setErrorMsg("");

          if (event.status === "connected" || event.status === "ready" ||
              event.status === "warmup"    || event.status === "recalibrating") {
            setIsConnected(true);
            setConnectedName(breathalyser.getConnectedDeviceName());
          }

          if (event.status === "scanning_bac") {
            // Device confirmed it started scanning — we are now awaiting BAC
            // (belt-and-suspenders alongside the flag set in requestScan)
            setIsConnected(true);
          }

          if (event.status === "disconnected") {
            setIsConnected(false);
            setConnectedName("");
            setBattery(0);
            // If we were waiting for a reading and device dropped, clear loading
            if (awaitingRef.current) {
              setIsAwaitingBac(false);
              awaitingRef.current = false;
            }
          }

          if (event.status === "ready") {
            // If awaiting BAC but device returned ready without a result = scan failed
            if (awaitingRef.current) {
              setIsAwaitingBac(false);
              awaitingRef.current = false;
            }
          }

          if (event.status === "error") {
            if (awaitingRef.current) {
              setIsAwaitingBac(false);
              awaitingRef.current = false;
            }
          }
          break;

        case "result":
          setResult(event.result);
          setHistory(prev => [event.result, ...prev].slice(0, 20));
          setRecalMsg("");
          // Result received — clear loading state
          setIsAwaitingBac(false);
          awaitingRef.current = false;
          break;

        case "battery":
          setBattery(event.level);
          break;

        case "recal":
          setRecalMsg("Sensor elevated — recalibrating. Wait before next reading.");
          if (awaitingRef.current) {
            setIsAwaitingBac(false);
            awaitingRef.current = false;
          }
          break;

        case "stable":
          setRecalMsg("Recalibration complete.");
          if (recalTimer.current) clearTimeout(recalTimer.current);
          recalTimer.current = setTimeout(() => setRecalMsg(""), 3_000);
          break;

        case "error":
          setErrorMsg(event.message);
          if (awaitingRef.current) {
            setIsAwaitingBac(false);
            awaitingRef.current = false;
          }
          break;

        case "debug":
          // Uncomment for development:
          // console.log("[BLE]", event.message);
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
      setErrorMsg("No device connected — go to the Breathalyser tab.");
      return;
    }

    const currentStatus = breathalyser.getStatus();
    if (currentStatus !== "ready" && currentStatus !== "connected") {
      // Device busy — not an error, just ignore silently
      return;
    }

    // Clear previous result and enter loading state before the write
    setResult(null);
    setErrorMsg("");
    setIsAwaitingBac(true);
    awaitingRef.current = true;

    try {
      await breathalyser.requestScan();
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Scan request failed — please try again.");
      setIsAwaitingBac(false);
      awaitingRef.current = false;
    }
  }, []);

  const clearResult = useCallback(() => {
    setResult(null);
    setErrorMsg("");
    setIsAwaitingBac(false);
    awaitingRef.current = false;
  }, []);

  return (
    <BreathalyserContext.Provider value={{
      status,
      result,
      history,
      errorMsg,
      recalMsg,
      battery,
      isConnected,
      isAwaitingBac,
      connectedName,
      requestScan,
      clearResult,
    }}>
      {children}
    </BreathalyserContext.Provider>
  );
}