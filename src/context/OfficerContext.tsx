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
  roleChanged: boolean;
  setOfficer: (o: OfficerState) => Promise<void>;
  clearOfficer: () => Promise<void>;
  acknowledgeRoleChange: () => void;
}

const OfficerContext = createContext<OfficerContextType>({
  officer: null,
  roleChanged: false,
  setOfficer: async () => {},
  clearOfficer: async () => {},
  acknowledgeRoleChange: () => {},
});

export const useOfficer = () => useContext(OfficerContext);

export function OfficerProvider({ children }: { children: React.ReactNode }) {
  const [officer, setOfficerState] = useState<OfficerState | null>(null);
  const [roleChanged, setRoleChanged] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const uidRef = useRef<string | null>(null);

  const connectSocket = (uid: string) => {
    // Disconnect old socket
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    uidRef.current = uid;

    const socket = io(BACKEND_URL, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("Socket connected, joining room:", uid);
      socket.emit("join", uid);
    });

    socket.on("reconnect", () => {
      // Rejoin room after reconnect
      if (uidRef.current) {
        socket.emit("join", uidRef.current);
      }
    });

    socket.on("roleUpdate", ({ role, status }: { role: Role; status: Status }) => {
      console.log("Role update received:", role, status);
      // Freeze session — force relogin
      setRoleChanged(true);
    });

    socket.on("disconnect", () => {
      console.log("Socket disconnected");
    });
  };

  const setOfficer = async (o: OfficerState) => {
    setOfficerState(o);
    await Cache.set("officer", o);
    connectSocket(o.uid);
  };

  const clearOfficer = async () => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    uidRef.current = null;
    setOfficerState(null);
    setRoleChanged(false);
    await Cache.remove("officer");
  };

  const acknowledgeRoleChange = () => {
    setRoleChanged(false);
  };

  // Restore session on app start
  useEffect(() => {
    Cache.get<OfficerState>("officer").then((cached) => {
      if (cached) {
        setOfficerState(cached);
        connectSocket(cached.uid);
      }
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  return (
    <OfficerContext.Provider value={{ officer, roleChanged, setOfficer, clearOfficer, acknowledgeRoleChange }}>
      {children}
    </OfficerContext.Provider>
  );
}