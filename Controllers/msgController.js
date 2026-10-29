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
    // Keep the sender's stable ID in the payload; the UI must never identify
    // a sender by display name because names are not unique.
    const populatedMessage = await message.populate("sender", "name");
    await Chat.findByIdAndUpdate(chat._id, { latestMessage: populatedMessage._id });

    for (const memberId of chat.users) {
        if (String(memberId) !== String(req.user._id)) {
            io.to(String(memberId)).emit("newMessage", populatedMessage);
        }
    }

    return res.status(200).json(populatedMessage);
});

const getChatMsgController = asyncHandler(async (req, res) => {
    const { chatID } = req.params;
    if (!mongoose.isValidObjectId(chatID)) {
        return res.status(400).json({ message: "A valid chat ID is required." });
    }

    const chat = await Chat.findOne({ _id: chatID, users: req.user._id }).select("_id users");
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

    // Opening a conversation marks only messages from other participants as
    // read. Return that state in the same response so the UI cannot render
    // stale unread indicators after the database has already been updated.
    await Message.updateMany(
        { chatId: chat._id, sender: { $ne: req.user._id }, isRead: false },
        { $set: { isRead: true } }
    );

    const responseMessages = paginated.map((message) => {
        const item = message.toObject();
        if (String(item.sender?._id) !== String(req.user._id)) item.isRead = true;
        return item;
    });

    // Tell the other participant(s) that their outgoing messages have been read.
    for (const memberId of chat.users) {
        if (String(memberId) !== String(req.user._id)) {
            io.to(String(memberId)).emit("markRead", String(chat._id));
        }
    }

    return res.status(200).json({ messages: responseMessages, hasMore });
});

module.exports = { sendMsgController, getChatMsgController };
