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

  const setOfficer = async (o: OfficerState) => {
    setOfficerState(o);
    await Cache.set("officer", o);

    if (socketRef.current) socketRef.current.disconnect();

    const socket = io(BACKEND_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("join", o.uid);
    });

    socket.on("roleUpdate", async ({ role, status }: { role: Role; status: Status }) => {
      const updated = { ...o, role, status };
      setOfficerState(updated);
      await Cache.set("officer", updated);
    });
  };

  const clearOfficer = async () => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    setOfficerState(null);
    await Cache.remove("officer");
  };

  useEffect(() => {
    Cache.get<OfficerState>("officer").then((cached) => {
      if (cached) setOfficer(cached);
    });
    return () => { socketRef.current?.disconnect(); };
  }, []);

  return (
    <OfficerContext.Provider value={{ officer, setOfficer, clearOfficer }}>
      {children}
    </OfficerContext.Provider>
  );
}