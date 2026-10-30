const express = require("express");
const http = require("http");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const Message = require("./Models/msgModel");
const Chat = require("./Models/chatModel");

const configuredOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin: configuredOrigins.length ? configuredOrigins : "*",
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  credentials: false,
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: corsOptions });

// A user can have multiple active tabs/devices.
const users = new Map();

function getUserSocketIds(userId) {
  return [...(users.get(String(userId)) || [])];
}

function getUserSocketId(userId) {
  return getUserSocketIds(userId)[0];
}

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token || !process.env.SECRET_KEY) {
    return next(new Error("Authentication required"));
  }

  jwt.verify(token, process.env.SECRET_KEY, (error, decoded) => {
    if (error || !decoded?._id || !mongoose.isValidObjectId(decoded._id)) {
      return next(new Error("Invalid or expired token"));
    }
    socket.data.userId = String(decoded._id);
    next();
  });
});

async function getAuthorizedChat(chatId, userId) {
  if (!mongoose.isValidObjectId(chatId)) return null;
  return Chat.findOne({ _id: chatId, users: userId }).select("_id users");
}

io.on("connection", (socket) => {
  const userId = socket.data.userId;
  const userSockets = users.get(userId) || new Set();
  userSockets.add(socket.id);
  users.set(userId, userSockets);
  socket.join(userId);
  io.emit("getOnlineUsers", [...users.keys()]);

  socket.on("isTyping", async ({ chatId } = {}) => {
    try {
      const chat = await getAuthorizedChat(chatId, userId);
      if (!chat) return;
      for (const memberId of chat.users) {
        const recipientId = String(memberId);
        if (recipientId !== userId) {
          io.to(recipientId).emit("typing", String(chat._id));
        }
      }
    } catch (error) {
      // Ignore malformed/unavailable typing events; never trust client-supplied recipient IDs.
    }
  });

  socket.on("stoppedTyping", async ({ chatId } = {}) => {
    try {
      const chat = await getAuthorizedChat(chatId, userId);
      if (!chat) return;
      for (const memberId of chat.users) {
        const recipientId = String(memberId);
        if (recipientId !== userId) {
          io.to(recipientId).emit("stoppedTyping", String(chat._id));
        }
      }
    } catch (error) {
      // Ignore malformed/unavailable typing events.
    }
  });

  socket.on("msgsRead", async ({ chatId } = {}) => {
    try {
      const chat = await getAuthorizedChat(chatId, userId);
      if (!chat) return;

      await Message.updateMany(
        { chatId: chat._id, sender: { $ne: userId } },
        { $set: { isRead: true } }
      );

      for (const memberId of chat.users) {
        const recipientId = String(memberId);
        if (recipientId !== userId) {
          io.to(recipientId).emit("markRead", String(chat._id));
        }
      }
    } catch (error) {
      // Invalid or inaccessible chat IDs are ignored.
    }
  });

  socket.on("disconnect", () => {
    const activeSockets = users.get(userId);
    if (activeSockets) {
      activeSockets.delete(socket.id);
      if (activeSockets.size === 0) users.delete(userId);
    }
    io.emit("getOnlineUsers", [...users.keys()]);
  });
});

module.exports = { app, server, io, corsOptions, getUserSocketId, getUserSocketIds };
