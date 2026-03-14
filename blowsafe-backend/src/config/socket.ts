import { Server } from "socket.io";
import type { Server as HTTPServer } from "http";

let io: Server;

export const initSocket = (server: HTTPServer): void => {
  io = new Server(server, {
    cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    socket.on("join", (uid: string) => {
      socket.join(uid);
    });
    socket.on("disconnect", () => {});
  });
};

export const getIO = (): Server => {
  if (!io) throw new Error("Socket not initialized");
  return io;
};

// Push role change to officer's device instantly
export const emitRoleUpdate = (firebaseUid: string, role: string): void => {
  if (io) {
    io.to(firebaseUid).emit("role_updated", { role });
  }
};