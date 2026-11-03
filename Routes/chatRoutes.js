const express = require("express")
const { authenticateToken } = require("../Config/tokenFunctions");
const chatController = require("../Controllers/chatController");
const chatRoutes = express.Router()

chatRoutes.post('/api/getAllChats', authenticateToken, chatController)
chatRoutes.delete('/api/:chatId', authenticateToken, chatController.deleteChatForUserController)
module.exports = chatRoutes;
