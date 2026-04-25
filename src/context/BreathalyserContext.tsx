import React, {
  createContext, useContext, useEffect,
  useState, useCallback, useRef,
} from "react";
import { breathalyser, type DeviceStatus, type BACResult, type GetReadingResult } from "../features/breathalyser";

interface BreathalyserContextType {
  status: DeviceStatus;
  result: BACResult | null;
  history: BACResult[];
  errorMsg: string;
  recalMsg: string;
  battery: number;
  isConnected: boolean;
  isAwaitingBac: boolean;
  connectedName: string;
  pendingQueueCount: number;
  requestScan: () => Promise<void>;
  clearResult: () => void;
  getReading: (options?: any) => Promise<GetReadingResult>;
  announceAccessibility: (message: string, priority?: "assertive" | "polite") => void;
}

const BreathalyserContext = createContext<BreathalyserContextType>({
  status: "disconnected",
  result: null,
  history: [],
  errorMsg: "",
  recalMsg: "",
  battery: 0,
  isConnected: false,
  isAwaitingBac: false,
  connectedName: "",
  pendingQueueCount: 0,
  requestScan: async () => {},
  clearResult: () => {},
  getReading: async () => ({ success: false, error: "device_not_ready" }),
  announceAccessibility: () => {},
});

export const useBreathalyser = () => useContext(BreathalyserContext);

export function BreathalyserProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<DeviceStatus>("disconnected");
  const [result, setResult] = useState<BACResult | null>(null);
  const [history, setHistory] = useState<BACResult[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [recalMsg, setRecalMsg] = useState("");
  const [battery, setBattery] = useState(0);
  const [connectedName, setConnectedName] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isAwaitingBac, setIsAwaitingBac] = useState(false);
  const [pendingQueueCount, setPendingQueueCount] = useState(0);

  const recalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const awaitingRef = useRef(false);

  useEffect(() => {
    const unsub = breathalyser.on((event) => {
      switch (event.type) {
        case "status":
          setStatus(event.status);
          if (event.status !== "error") setErrorMsg("");
          if (["connected", "ready", "warmup", "recalibrating"].includes(event.status)) {
            setIsConnected(true);
            setConnectedName(breathalyser.getConnectedDeviceName());
          }
          if (event.status === "scanning_bac") {
            setIsConnected(true);
          }
          if (event.status === "disconnected") {
            setIsConnected(false);
            setConnectedName("");
            setBattery(0);
            if (awaitingRef.current) {
              setIsAwaitingBac(false);
              awaitingRef.current = false;
            }
          }
          if (event.status === "ready" && awaitingRef.current) {
            setIsAwaitingBac(false);
            awaitingRef.current = false;
          }
          if (event.status === "error" && awaitingRef.current) {
            setIsAwaitingBac(false);
            awaitingRef.current = false;
          }
          break;

        case "result":
          setResult(event.result);
          setHistory(prev => [event.result, ...prev].slice(0, 20));
          setRecalMsg("");
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

        case "progress":
          if (__DEV__ && event.step === "awaiting_sensor") {
            console.log("[Progress] Sensor active");
          }
          break;

        case "accessibility":
          // Handled by screen component via breathalyser.on()
          break;

        case "debug":
          // console.log("[BLE]", event.message);
          break;
      }
    });

    const queueInterval = setInterval(() => {
      setPendingQueueCount(breathalyser.getPendingQueueCount());
    }, 2000);

    return () => {
      unsub();
      clearInterval(queueInterval);
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
      return;
    }
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

  const getReading = useCallback(async (options: any = {}) => {
    return await breathalyser.getReading({
      ...options,
      onProgress: (step: any) => {
        if (__DEV__ && step === "awaiting_sensor") {
          console.log("[Progress] Sensor active");
        }
      },
      onAccessibilityAnnouncement: (msg: string, priority: any) => {
        announceAccessibility(msg, priority);
      }
    });
  }, []);

  const announceAccessibility = useCallback((message: string, priority: "assertive" | "polite" = "polite") => {
    // Screen listens via breathalyser.on() for "accessibility" events
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
      pendingQueueCount,
      requestScan,
      clearResult,
      getReading,
      announceAccessibility,
    }}>
      {children}
    </BreathalyserContext.Provider>
  );
}