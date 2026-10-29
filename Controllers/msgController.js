const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Message = require("../Models/msgModel");
const Chat = require("../Models/chatModel");
const { io } = require("../socketio");

const MAX_MESSAGE_LENGTH = 5000;

const sendMsgController = asyncHandler(async (req, res) => {
    const { content, chatID } = req.body || {};
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
    if (!chat) {
        return res.status(404).json({ message: "Conversation not found." });
    }

    const message = await Message.create({
        sender: req.user._id,
        content: trimmedContent,
        chatId: chat._id,
    });
    const populatedMessage = await message.populate("sender", "name");
    await Chat.findByIdAndUpdate(chat._id, { latestMessage: populatedMessage });

    // Deliver to all of the other participant's active sockets. Socket rooms are
    // populated only after the server verifies the user's JWT.
    for (const memberId of chat.users) {
        if (String(memberId) !== String(req.user._id)) {
            io.to(String(memberId)).emit("newMessage", populatedMessage);
        }
    }

    // Keep the existing frontend contract: it checks for HTTP 200.
    return res.status(200).json(populatedMessage);
});

const getChatMsgController = asyncHandler(async (req, res) => {
    const { chatID } = req.params;
    if (!mongoose.isValidObjectId(chatID)) {
        return res.status(400).json({ message: "A valid chat ID is required." });
    }

    const chat = await Chat.findOne({ _id: chatID, users: req.user._id }).select("_id");
    if (!chat) {
        return res.status(404).json({ message: "Conversation not found." });
    }

    const LIMIT = 30;
    const { before } = req.query;
    if (before && !mongoose.isValidObjectId(before)) {
        return res.status(400).json({ message: "The pagination cursor is invalid." });
    }

    const query = { chatId: chat._id };
    if (before) query._id = { $lt: before };

    const messages = await Message.find(query)
        .populate("sender", "name")
        .sort({ _id: -1 })
        .limit(LIMIT + 1);

    const hasMore = messages.length > LIMIT;
    const paginated = hasMore ? messages.slice(0, LIMIT) : messages;

    await Message.updateMany(
        { chatId: chat._id, sender: { $ne: req.user._id } },
        { $set: { isRead: true } }
    );

    return res.status(200).json({ messages: paginated, hasMore });
});

module.exports = { sendMsgController, getChatMsgController };
