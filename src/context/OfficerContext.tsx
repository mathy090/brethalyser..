import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { BACKEND_URL } from "@env";
import { Cache } from "../utils/cache";

export type Role = "officer" | "admin" | "superadmin";
export type Status = "pending" | "approved" | "rejected";

interface OfficerState {
  uid: string;
  officerId: string;
  role: Role;
  status: Status;
}

interface OfficerContextType {
  officer: OfficerState | null;
  setOfficer: (o: OfficerState) => Promise<void>;
  clearOfficer: () => Promise<void>;
}

const OfficerContext = createContext<OfficerContextType>({
  officer: null,
  setOfficer: async () => {},
  clearOfficer: async () => {},
});

export const useOfficer = () => useContext(OfficerContext);

export function OfficerProvider({ children }: { children: React.ReactNode }) {
  const [officer, setOfficerState] = useState<OfficerState | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const connectSocket = (o: OfficerState) => {
    // Disconnect existing socket first
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    const socket = io(BACKEND_URL, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("Socket connected, joining room:", o.uid);
      socket.emit("join", o.uid);
    });

    socket.on("disconnect", () => {
      console.log("Socket disconnected");
    });

    // Backend pushed a role change — update state and cache instantly
    socket.on("roleUpdate", async ({ role, status }: { role: Role; status: Status }) => {
      console.log("Role update received:", role, status);
      const updated: OfficerState = { ...o, role, status };
      setOfficerState(updated);
      await Cache.set("officer", updated);
    });
  };

  const setOfficer = async (o: OfficerState) => {
    setOfficerState(o);
    await Cache.set("officer", o);
    connectSocket(o);
  };

  const clearOfficer = async () => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    setOfficerState(null);
    await Cache.remove("officer");
  };

  // Restore session from cache on app start
  useEffect(() => {
    Cache.get<OfficerState>("officer").then((cached) => {
      if (cached) {
        setOfficerState(cached);
        connectSocket(cached);
      }
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  return (
    <OfficerContext.Provider value={{ officer, setOfficer, clearOfficer }}>
      {children}
    </OfficerContext.Provider>
  );
}