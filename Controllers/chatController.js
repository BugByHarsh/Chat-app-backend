const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const User = require("../Models/userModel");
const Chat = require("../Models/chatModel");
const Message = require("../Models/msgModel");
const { io } = require("../socketio");

const populateChats = (query) => query
    .populate("users", "name email")
    .populate({
        path: "latestMessage",
        populate: { path: "sender", select: "name email" },
    })
    .sort({ updatedAt: -1 });

const deleteChatForUserController = asyncHandler(async (req, res) => {
    const { chatId } = req.params || {};
    if (!mongoose.isValidObjectId(chatId)) {
        return res.status(400).json({ message: "A valid chat ID is required." });
    }

    const chat = await Chat.findOne({ _id: chatId, users: req.user._id });
    if (!chat) return res.status(404).json({ message: "Conversation not found." });

    const userId = String(req.user._id);
    const clearedEntry = chat.clearedFor.find((entry) => String(entry.user) === userId);
    if (clearedEntry) clearedEntry.clearedAt = new Date();
    else chat.clearedFor.push({ user: req.user._id, clearedAt: new Date() });

    if (!chat.hiddenFor.some((hiddenId) => String(hiddenId) === userId)) {
        chat.hiddenFor.push(req.user._id);
    }
    await chat.save();

    const allParticipantsDeleted = chat.users.length > 0 &&
        chat.users.every((memberId) =>
            chat.hiddenFor.some((hiddenId) => String(hiddenId) === String(memberId))
        );

    if (allParticipantsDeleted) {
        await Message.deleteMany({ chatId: chat._id });
        await Chat.deleteOne({ _id: chat._id });
        for (const memberId of chat.users) {
            io.to(String(memberId)).emit("chatDeletedForEveryone", { chatId: String(chat._id) });
        }
        return res.status(200).json({
            message: "Conversation and its messages were permanently deleted.",
            chatId: String(chat._id),
            permanentlyDeleted: true,
        });
    }

    return res.status(200).json({
        message: "Chat deleted for you. New incoming messages will start a fresh visible conversation.",
        chatId: String(chat._id),
        permanentlyDeleted: false,
    });
});

const createChatController = asyncHandler(async (req, res) => {
    const user = req.user;
    const { userId } = req.body || {};

    if (userId === undefined) {
        // Recover a hidden conversation only when a genuinely new incoming
        // message arrived after this user's clear point. The message query
        // separately applies clearedFor so old history stays out of view.
        const hiddenChats = await Chat.find({
            users: user._id,
            hiddenFor: user._id,
        }).populate("latestMessage", "sender createdAt");

        for (const hiddenChat of hiddenChats) {
            const latest = hiddenChat.latestMessage;
            if (!latest || String(latest.sender) === String(user._id)) continue;

            const clearedEntry = hiddenChat.clearedFor.find(
                (entry) => String(entry.user) === String(user._id)
            );
            const clearedAt = clearedEntry?.clearedAt
                ? new Date(clearedEntry.clearedAt).getTime()
                : 0;
            const latestAt = latest.createdAt
                ? new Date(latest.createdAt).getTime()
                : 0;

            if (latestAt > clearedAt) {
                await Chat.updateOne(
                    { _id: hiddenChat._id },
                    { $pull: { hiddenFor: user._id } }
                );
            }
        }

        const fullChat = await populateChats(
            Chat.find({ users: user._id, hiddenFor: { $ne: user._id } })
        );
        return res.status(200).json({ fullChat });
    }

    if (!mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ message: "A valid user ID is required." });
    }
    if (String(userId) === String(user._id)) {
        return res.status(400).json({ message: "You cannot start a conversation with yourself." });
    }

    const targetUser = await User.findById(userId).select("_id");
    if (!targetUser) {
        return res.status(404).json({ message: "User not found." });
    }

    const existingChat = await Chat.findOne({
        users: { $all: [user._id, targetUser._id], $size: 2 },
    });

    if (!existingChat) {
        const chatItem = await Chat.create({
            chatName: `${user._id} and ${targetUser._id}`,
            users: [user._id, targetUser._id],
        });
        const populatedChat = await Chat.findById(chatItem._id)
            .populate("users", "name email");
        io.to(String(targetUser._id)).emit("newChat", populatedChat);
    }

    const fullChat = await populateChats(Chat.find({ users: user._id, hiddenFor: { $ne: user._id } }));
    return res.status(200).json({ fullChat });
});

module.exports = createChatController;
module.exports.deleteChatForUserController = deleteChatForUserController;
