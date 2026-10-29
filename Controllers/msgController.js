const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Message = require("../Models/msgModel");
const Chat = require("../Models/chatModel");
const { io } = require("../socketio");

const MAX_MESSAGE_LENGTH = 5000;
const ALLOWED_REACTIONS = new Set(["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "🎉"]);

async function populateMessage(message) {
    return message.populate([
        { path: "sender", select: "name username" },
        { path: "replyTo", select: "content sender deletedAt", populate: { path: "sender", select: "name username" } },
        { path: "reactions.user", select: "name username" },
    ]);
}

async function emitToChatMembers(chat, event, payload, exceptUserId = null) {
    for (const memberId of chat.users) {
        const recipientId = String(memberId);
        if (exceptUserId && recipientId === String(exceptUserId)) continue;
        io.to(recipientId).emit(event, payload);
    }
}

async function getMessageAndAuthorizedChat(messageId, userId) {
    if (!mongoose.isValidObjectId(messageId)) return { error: "invalid" };
    const message = await Message.findById(messageId);
    if (!message) return { error: "missing" };
    const chat = await Chat.findOne({ _id: message.chatId, users: userId }).select("_id users");
    if (!chat) return { error: "forbidden" };
    return { message, chat };
}

const sendMsgController = asyncHandler(async (req, res) => {
    const { content, chatID, replyTo } = req.body || {};
    const trimmedContent = typeof content === "string" ? content.trim() : "";

    if (!mongoose.isValidObjectId(chatID)) {
        return res.status(400).json({ message: "A valid chat ID is required." });
    }
    if (!trimmedContent) {
        return res.status(400).json({ message: "Message content cannot be empty." });
    }
    if (trimmedContent.length > MAX_MESSAGE_LENGTH) {
        return res.status(413).json({ message: `Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer.` });
    }

    const chat = await Chat.findOne({ _id: chatID, users: req.user._id }).select("_id users");
    if (!chat) return res.status(404).json({ message: "Conversation not found." });

    let replyMessage = null;
    if (replyTo) {
        if (!mongoose.isValidObjectId(replyTo)) {
            return res.status(400).json({ message: "The replied-to message ID is invalid." });
        }
        replyMessage = await Message.findOne({ _id: replyTo, chatId: chat._id });
        if (!replyMessage) return res.status(404).json({ message: "The replied-to message was not found." });
    }

    const message = await Message.create({
        sender: req.user._id,
        content: trimmedContent,
        chatId: chat._id,
        replyTo: replyMessage?._id || null,
    });
    const populatedMessage = await populateMessage(message);
    await Chat.findByIdAndUpdate(chat._id, { latestMessage: populatedMessage._id });
    await emitToChatMembers(chat, "newMessage", populatedMessage, req.user._id);
    return res.status(200).json(populatedMessage);
});

const getChatMsgController = asyncHandler(async (req, res) => {
    const { chatID } = req.params;
    if (!mongoose.isValidObjectId(chatID)) {
        return res.status(400).json({ message: "A valid chat ID is required." });
    }

    const chat = await Chat.findOne({ _id: chatID, users: req.user._id }).select("_id users");
    if (!chat) return res.status(404).json({ message: "Conversation not found." });

    const LIMIT = 30;
    const { before } = req.query;
    if (before && !mongoose.isValidObjectId(before)) {
        return res.status(400).json({ message: "The pagination cursor is invalid." });
    }

    const query = { chatId: chat._id };
    if (before) query._id = { $lt: before };

    const messages = await Message.find(query)
        .populate("sender", "name username")
        .populate({ path: "replyTo", select: "content sender deletedAt", populate: { path: "sender", select: "name username" } })
        .populate("reactions.user", "name username")
        .sort({ _id: -1 })
        .limit(LIMIT + 1);

    const hasMore = messages.length > LIMIT;
    const paginated = hasMore ? messages.slice(0, LIMIT) : messages;
    await Message.updateMany(
        { chatId: chat._id, sender: { $ne: req.user._id }, isRead: false },
        { $set: { isRead: true } }
    );

    const responseMessages = paginated.map((message) => {
        const item = message.toObject();
        if (String(item.sender?._id) !== String(req.user._id)) item.isRead = true;
        return item;
    });

    await emitToChatMembers(chat, "markRead", String(chat._id), req.user._id);
    return res.status(200).json({ messages: responseMessages, hasMore });
});

const editMsgController = asyncHandler(async (req, res) => {
    const { content } = req.body || {};
    const trimmedContent = typeof content === "string" ? content.trim() : "";
    if (!trimmedContent) return res.status(400).json({ message: "Message content cannot be empty." });
    if (trimmedContent.length > MAX_MESSAGE_LENGTH) {
        return res.status(413).json({ message: `Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer.` });
    }

    const result = await getMessageAndAuthorizedChat(req.params.messageId, req.user._id);
    if (result.error === "invalid") return res.status(400).json({ message: "A valid message ID is required." });
    if (result.error === "missing") return res.status(404).json({ message: "Message not found." });
    if (result.error) return res.status(403).json({ message: "You cannot access this conversation." });
    const { message, chat } = result;
    if (String(message.sender) !== String(req.user._id)) return res.status(403).json({ message: "You can only edit your own messages." });
    if (message.deletedAt) return res.status(409).json({ message: "Deleted messages cannot be edited." });

    message.content = trimmedContent;
    message.editedAt = new Date();
    await message.save();
    const updated = await populateMessage(message);
    await emitToChatMembers(chat, "messageUpdated", updated, req.user._id);
    return res.status(200).json(updated);
});

const deleteMsgController = asyncHandler(async (req, res) => {
    const result = await getMessageAndAuthorizedChat(req.params.messageId, req.user._id);
    if (result.error === "invalid") return res.status(400).json({ message: "A valid message ID is required." });
    if (result.error === "missing") return res.status(404).json({ message: "Message not found." });
    if (result.error) return res.status(403).json({ message: "You cannot access this conversation." });
    const { message, chat } = result;
    if (String(message.sender) !== String(req.user._id)) return res.status(403).json({ message: "You can only delete your own messages." });
    if (!message.deletedAt) {
        message.content = "";
        message.deletedAt = new Date();
        message.reactions = [];
        await message.save();
    }
    const deleted = await populateMessage(message);
    await emitToChatMembers(chat, "messageDeleted", deleted, req.user._id);
    return res.status(200).json(deleted);
});

const toggleReactionController = asyncHandler(async (req, res) => {
    const { emoji } = req.body || {};
    if (typeof emoji !== "string" || !ALLOWED_REACTIONS.has(emoji)) {
        return res.status(400).json({ message: "That reaction is not supported." });
    }

    const result = await getMessageAndAuthorizedChat(req.params.messageId, req.user._id);
    if (result.error === "invalid") return res.status(400).json({ message: "A valid message ID is required." });
    if (result.error === "missing") return res.status(404).json({ message: "Message not found." });
    if (result.error) return res.status(403).json({ message: "You cannot access this conversation." });
    const { message, chat } = result;
    if (message.deletedAt) return res.status(409).json({ message: "Deleted messages cannot be reacted to." });

    const userId = String(req.user._id);
    const existingIndex = message.reactions.findIndex((reaction) => String(reaction.user) === userId && reaction.emoji === emoji);
    if (existingIndex >= 0) message.reactions.splice(existingIndex, 1);
    else message.reactions.push({ user: req.user._id, emoji });
    await message.save();

    const updated = await populateMessage(message);
    await emitToChatMembers(chat, "messageReactionUpdated", updated, req.user._id);
    return res.status(200).json(updated);
});

module.exports = {
    sendMsgController,
    getChatMsgController,
    editMsgController,
    deleteMsgController,
    toggleReactionController,
};
