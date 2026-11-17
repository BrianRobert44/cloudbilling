const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/env");
const db = require("../config/db");

let io = null;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingTimeout: 30000,
    pingInterval: 10000,
  });

  // Authenticate socket connections
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace("Bearer ", "");

      if (!token) {
        return next(new Error("Authentication token required."));
      }

      const decoded = jwt.verify(token, JWT_SECRET);
      const userId = decoded.id || decoded.userId;
      const sessionId = decoded.sessionId;

      if (!userId || !sessionId) {
        return next(new Error("Invalid token claims."));
      }

      // Check active session in database
      const [users] = await db.query(
        "SELECT id, active_session_id, is_active FROM users WHERE id = ? LIMIT 1",
        [userId]
      );

      if (!users.length || Number(users[0].is_active) !== 1) {
        return next(new Error("User account not found or deactivated."));
      }

      if (users[0].active_session_id && users[0].active_session_id !== sessionId) {
        return next(new Error("SESSION_REPLACED"));
      }

      socket.userId = userId;
      socket.sessionId = sessionId;
      return next();
    } catch (err) {
      return next(new Error("Socket authentication failed: " + err.message));
    }
  });

  io.on("connection", (socket) => {
    const userRoom = `user_${socket.userId}`;
    socket.join(userRoom);

    socket.on("disconnect", (reason) => {
      // socket disconnected
    });
  });

  return io;
}

/**
 * Notify previous sessions of a user that a new login has occurred.
 * All active sockets for this user whose sessionId does NOT match newSessionId
 * will receive the 'session_replaced' event and then be disconnected.
 */
async function notifySessionReplaced(userId, newSessionId) {
  if (!io) return;

  const userRoom = `user_${userId}`;
  const socketsInRoom = await io.in(userRoom).fetchSockets();

  for (const s of socketsInRoom) {
    if (s.sessionId && s.sessionId !== newSessionId) {
      s.emit("session_replaced", {
        code: "SESSION_REPLACED",
        message:
          "Your account has been logged in on another device. You have been logged out for security reasons.",
      });

      // Disconnect the replaced socket
      setTimeout(() => {
        try {
          s.disconnect(true);
        } catch (_) {}
      }, 500);
    }
  }
}

function getIo() {
  return io;
}

module.exports = {
  initSocket,
  notifySessionReplaced,
  getIo,
};
