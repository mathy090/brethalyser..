import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io, Socket } from "socket.io-client";
import { useOfficer } from "../context/OfficerContext";

// ✅ Dynamic WebSocket URL using environment variables
const getWebSocketUrl = (): string => {
  const isProduction = import.meta.env.PROD;
  
  if (isProduction) {
    // ✅ Render/Production: use wss:// + current hostname (no port, uses 443)
    const host = window.location.hostname;
    return `wss://${host}`;
  }
  
  // ✅ Development: use env var or fallback
  return import.meta.env.VITE_WS_URL || `ws://localhost:${import.meta.env.VITE_BACKEND_PORT || 3000}`;
};

const WS_URL = getWebSocketUrl();
const STRICT_ROLES = new Set(["admin", "superadmin"]);

export function useAdminWebSocket() {
  const navigate = useNavigate();
  const { officer } = useOfficer();
  const socketRef = useRef<Socket | null>(null);
  const isStrict = officer ? STRICT_ROLES.has(officer.role) : false;

  useEffect(() => {
    // Only connect for admin/superadmin roles
    if (!isStrict || !officer) return;
    
    const token = localStorage.getItem("jwt_token");
    if (!token) return;

    console.log(`🔌 Connecting to WS: ${WS_URL} | Officer: ${officer.officerId}`);

    const socket = io(WS_URL, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false, // ✅ Force explicit re-login on disconnect
      timeout: 10000,
      extraHeaders: {
        Origin: window.location.origin, // ✅ Critical for Render CORS
      },
    });

    socketRef.current = socket;

    // ✅ Instant logout on ANY disconnect/error
    const handleSessionBreak = (reason: string) => {
      console.warn(`⚠️ WS Session Broken: ${reason}`);
      localStorage.clear();
      sessionStorage.clear();
      navigate("/session-interrupted", { replace: true });
    };

    socket.on("connect", () => {
      console.log("✅ WS Connected successfully");
    });

    socket.on("disconnect", (reason) => {
      handleSessionBreak(`disconnect:${reason}`);
    });

    socket.on("connect_error", (err) => {
      console.error("❌ WS Connect Error:", err.message);
      handleSessionBreak("connect_error");
    });

    socket.on("error", (err) => {
      console.error("❌ WS Error:", err.message);
      handleSessionBreak("error");
    });

    // Cleanup on unmount
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current.off("disconnect", handleSessionBreak);
        socketRef.current.off("connect_error", handleSessionBreak);
        socketRef.current.off("error", handleSessionBreak);
      }
    };
  }, [isStrict, officer, navigate]);

  return socketRef.current;
}