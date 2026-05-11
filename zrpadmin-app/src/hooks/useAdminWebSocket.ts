import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, Socket } from "socket.io-client";
import { useOfficer } from "../context/OfficerContext";

const WS_URL = import.meta.env.VITE_WS_URL || import.meta.env.VITE_BACKEND_URL;
const STRICT_ROLES = new Set(["admin", "superadmin"]);

export function useAdminWebSocket() {
  const navigate = useNavigate();
  const { officer } = useOfficer();
  const socketRef = useRef<Socket | null>(null);
  const isStrict = officer ? STRICT_ROLES.has(officer.role) : false;

  useEffect(() => {
    if (!isStrict || !officer) return;
    const token = localStorage.getItem("jwt_token");
    if (!token) return;

    const socket = io(WS_URL, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false, // We handle disconnect manually
      timeout: 5000,
    });

    socketRef.current = socket;

    const handleDisconnect = (reason: string) => {
      console.warn("⚠️ WS Session Broken:", reason);
      localStorage.clear();
      sessionStorage.clear();
      navigate("/session-interrupted", { replace: true });
    };

    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleDisconnect);
    socket.on("error", handleDisconnect);

    return () => {
      socket.disconnect();
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleDisconnect);
      socket.off("error", handleDisconnect);
    };
  }, [isStrict, officer, navigate]);

  return socketRef.current;
}