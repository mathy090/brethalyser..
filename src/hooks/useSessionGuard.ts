import { useEffect, useRef, useCallback } from "react";
import { AppState, type AppStateStatus } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import axios from "axios";
import { BACKEND_URL } from "@env";
import { getToken, clearSecureStorage } from "../security/secureStorage";
import { refreshJWT } from "../auth/authService";
import { Cache } from "../utils/cache";
import { useOfficer } from "../context/OfficerContext";

const api = axios.create({ baseURL: BACKEND_URL, timeout: 8_000 });

interface UseSessionGuardOptions {
  onSessionInvalid: () => void;
}

export function useSessionGuard({ onSessionInvalid }: UseSessionGuardOptions) {
  const { clearOfficer } = useOfficer();
  const isVerifying     = useRef(false);
  const lastVerified    = useRef<number>(0);
  const VERIFY_INTERVAL = 60_000;

  const signOutAndClear = useCallback(async () => {
    await clearSecureStorage();
    await Cache.clear();
    await clearOfficer();
    // just call the callback — no navigation here
    onSessionInvalid();
  }, [clearOfficer, onSessionInvalid]);

  const verifyWithBackend = useCallback(async () => {
    if (isVerifying.current) return;
    if (Date.now() - lastVerified.current < VERIFY_INTERVAL) return;

    isVerifying.current = true;
    try {
      const token = await getToken();
      if (!token) {
        await signOutAndClear();
        return;
      }
      try {
        const { data } = await api.post(
          "/api/auth/verify",
          {},
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (data?.valid) {
          lastVerified.current = Date.now();
          return;
        }
        throw new Error("invalid");
      } catch (err: any) {
        if (!err.response) return; // no network — stay logged in
        if (
          err.response?.status === 401 ||
          err.response?.status === 403 ||
          err.message === "invalid"
        ) {
          const refreshed = await refreshJWT();
          if (refreshed) {
            lastVerified.current = Date.now();
            return;
          }
          await signOutAndClear();
        }
      }
    } finally {
      isVerifying.current = false;
    }
  }, [signOutAndClear]);

  useEffect(() => {
    // small delay so the navigator has time to mount before
    // any network event could trigger a state change
    const initTimer = setTimeout(() => {
      NetInfo.fetch().then((state) => {
        if (state.isConnected && state.isInternetReachable) {
          verifyWithBackend();
        }
      });
    }, 1500);

    const unsubNet = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable) {
        verifyWithBackend();
      }
    });

    const unsubApp = AppState.addEventListener(
      "change",
      (next: AppStateStatus) => {
        if (next === "active") verifyWithBackend();
      }
    );

    return () => {
      clearTimeout(initTimer);
      unsubNet();
      unsubApp.remove();
    };
  }, [verifyWithBackend]);
}