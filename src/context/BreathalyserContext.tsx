// src/context/BreathalyserContext.tsx
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react';
import { breathalyser, ScannedDevice } from '../features/breathalyser';

export interface Result {
  bacPercent: string;
  bacMg: string;
  overLimit: boolean;
  timestamp: number;
}

interface BreathalyserContextValue {
  isConnected: boolean;
  deviceStatus: string;         // 'disconnected' | 'warmup' | 'ready' | 'scanning' | 'recalibrating'
  result: Result | null;
  history: Result[];
  clearResult: () => void;
  connectMsg: string | null;
  devices: ScannedDevice[];
  setDevices: React.Dispatch<React.SetStateAction<ScannedDevice[]>>;
  setDeviceStatus: (status: string) => void;
  isReadingActive: boolean;
  isReadingComplete: boolean;
  progressPercent: number;
  countdownSeconds: number;
  setReadingActive: (v: boolean) => void;
  setReadingComplete: (v: boolean) => void;
  setProgressPercent: (v: number) => void;
}

const BreathalyserContext = createContext<BreathalyserContextValue | undefined>(undefined);

const BAC_LIMIT = 0.05;
const WARMUP_TOTAL_SEC = 30;
const RECALIB_TOTAL_SEC = 20;

export const BreathalyserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState('disconnected');
  const [result, setResult] = useState<Result | null>(null);
  const [history, setHistory] = useState<Result[]>([]);
  const [connectMsg, setConnectMsg] = useState<string | null>(null);
  const [devices, setDevices] = useState<ScannedDevice[]>([]);

  const [isReadingActive, setReadingActive] = useState(false);
  const [isReadingComplete, setReadingComplete] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [countdownSeconds, setCountdownSeconds] = useState(0);

  const progressRef = useRef(0);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isScanningRef = useRef(false);

  const flashMessage = useCallback((msg: string) => {
    setConnectMsg(msg);
    setTimeout(() => setConnectMsg(null), 3500);
  }, []);

  const toProgressPercent = (remaining: number, total: number) => {
    const elapsed = total - remaining;
    return (elapsed / total) * 100;
  };

  // ─── Handle incoming BLE messages ────────────
  useEffect(() => {
    const unsub = breathalyser.on((event) => {
      if (event.type === 'status') {
        if (event.status === 'connected') {
          setIsConnected(true);
          // Do NOT set deviceStatus to 'warmup' here – let the Arduino tell us
          flashMessage('Device connected');
        } else if (event.status === 'disconnected') {
          setIsConnected(false);
          setDeviceStatus('disconnected');
          setResult(null);
          setReadingActive(false);
          setReadingComplete(false);
          setProgressPercent(0);
          setCountdownSeconds(0);
          flashMessage('Device disconnected');
        } else if (event.status === 'error') {
          flashMessage(event.message || 'Connection error');
        }
      }

      if (event.type === 'reading') {
        const msg = event.value.trim();
        if (!msg) return;

        if (msg.startsWith('STATUS:')) {
          const parts = msg.substring(7).split(':');
          const status = parts[0];
          const param = parts.length > 1 ? parseInt(parts[1], 10) : undefined;

          switch (status) {
            case 'WARMUP':
              setDeviceStatus('warmup');
              setReadingActive(false);
              if (param !== undefined) {
                setCountdownSeconds(param);
                setProgressPercent(toProgressPercent(param, WARMUP_TOTAL_SEC));
              }
              break;

            case 'READY':
              setDeviceStatus('ready');
              setProgressPercent(0);
              setCountdownSeconds(0);
              setReadingActive(false);
              setReadingComplete(false);
              break;

            case 'SCANNING':
              setDeviceStatus('scanning');
              setReadingActive(true);
              setReadingComplete(false);
              setProgressPercent(0);
              setCountdownSeconds(0);
              startScanningProgress();
              break;

            case 'RECALIBRATING':
              setDeviceStatus('recalibrating');
              setReadingActive(false);
              setReadingComplete(true);
              if (param !== undefined) {
                setCountdownSeconds(param);
                setProgressPercent(toProgressPercent(param, RECALIB_TOTAL_SEC));
              }
              break;
          }
        }

        if (msg.startsWith('BAC:')) {
          stopScanningProgress();
          const bacValue = msg.substring(4);
          const bacNum = parseFloat(bacValue);
          const overLimit = bacNum >= BAC_LIMIT;

          const newResult: Result = {
            bacPercent: `${bacNum.toFixed(2)}%`,
            bacMg: `${(bacNum * 10).toFixed(2)} mg/L`,
            overLimit,
            timestamp: Date.now(),
          };

          setResult(newResult);
          setHistory((prev) => [newResult, ...prev]);
          setProgressPercent(100);
          setCountdownSeconds(0);
          setReadingComplete(true);
        }
      }
    });

    return unsub;
  }, [flashMessage]);

  const startScanningProgress = useCallback(() => {
    stopScanningProgress();
    isScanningRef.current = true;
    progressRef.current = 0;
    setProgressPercent(0);

    scanTimerRef.current = setInterval(() => {
      if (!isScanningRef.current) return;
      progressRef.current = Math.min(progressRef.current + 2, 98);
      setProgressPercent(progressRef.current);
    }, 40);
  }, []);

  const stopScanningProgress = useCallback(() => {
    isScanningRef.current = false;
    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopScanningProgress();
  }, [stopScanningProgress]);

  const clearResult = useCallback(() => {
    setResult(null);
    setReadingComplete(false);
  }, []);

  const value: BreathalyserContextValue = {
    isConnected,
    deviceStatus,
    result,
    history,
    clearResult,
    connectMsg,
    devices,
    setDevices,
    setDeviceStatus,
    isReadingActive,
    isReadingComplete,
    progressPercent,
    countdownSeconds,
    setReadingActive,
    setReadingComplete,
    setProgressPercent,
  };

  return (
    <BreathalyserContext.Provider value={value}>
      {children}
    </BreathalyserContext.Provider>
  );
};

export const useBreathalyser = () => {
  const ctx = useContext(BreathalyserContext);
  if (!ctx) throw new Error('useBreathalyser must be inside BreathalyserProvider');
  return ctx;
};