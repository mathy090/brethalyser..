import { Server } from "socket.io";
import type { Server as HTTPServer } from "http";

let io: Server;

export const initSocket = (server: HTTPServer): void => {
  io = new Server(server, {
    cors: { origin: "*" },
    transports: ["websocket"],
  });

  io.on("connection", (socket) => {
    // Officer joins their own private room using firebaseUid
    socket.on("join", (uid: string) => {
      socket.join(uid);
      console.log(`Officer joined room: ${uid}`);
    });

    socket.on("disconnect", () => {
      console.log("Socket disconnected");
    });
  });
};

// Call this when admin changes a role in MongoDB
export const emitRoleUpdate = (firebaseUid: string, role: string, status: string): void => {
  if (io) {
    io.to(firebaseUid).emit("roleUpdate", { role, status });
    console.log(`Role update emitted to ${firebaseUid}: ${role}`);
  }
};

export { io };