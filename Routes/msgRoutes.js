const express = require('express');
const {
    sendMsgController,
    getChatMsgController,
    editMsgController,
    deleteMsgController,
    toggleReactionController,
} = require('../Controllers/msgController');
const { authenticateToken } = require('../Config/tokenFunctions');

const msgRoutes = express.Router();

msgRoutes.post('/', authenticateToken, sendMsgController);
msgRoutes.get('/:chatID', authenticateToken, getChatMsgController);
msgRoutes.patch('/:messageId', authenticateToken, editMsgController);
msgRoutes.delete('/:messageId', authenticateToken, deleteMsgController);
msgRoutes.post('/:messageId/reactions', authenticateToken, toggleReactionController);

module.exports = msgRoutes;
