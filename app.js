require("dotenv").config();

const express = require("express");
const cors = require("cors");
const conn = require("./Config/database");
const userRoutes = require("./Routes/userRoutes");
const chatRoutes = require("./Routes/chatRoutes");
const msgRoutes = require("./Routes/msgRoutes");
const { app, server, corsOptions } = require("./socketio");
app.use(cors(corsOptions));
app.use(express.json());

app.use("/user", userRoutes);
app.use("/chat", chatRoutes);
app.use("/msg", msgRoutes);

app.get("/", (req, res) => {
  res.send("API is running successfully");
});

server.listen(process.env.PORT || 3000, () => {
});
