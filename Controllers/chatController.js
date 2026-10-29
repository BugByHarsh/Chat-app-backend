const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const User = require("../Models/userModel");
const Chat = require("../Models/chatModel");
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

    const chat = await Chat.findOneAndUpdate(
        { _id: chatId, users: req.user._id },
        { $addToSet: { hiddenFor: req.user._id } },
        { new: true, projection: { _id: 1 } }
    );
    if (!chat) return res.status(404).json({ message: "Conversation not found." });
    return res.status(200).json({ message: "Chat deleted for you.", chatId: String(chat._id) });
});

const createChatController = asyncHandler(async (req, res) => {
    const user = req.user;
    const { userId } = req.body || {};

    if (userId === undefined) {
        const fullChat = await populateChats(Chat.find({ users: user._id, hiddenFor: { $ne: user._id } }));
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

    const fullChat = await populateChats(Chat.find({ users: user._id }));
    return res.status(200).json({ fullChat });
});

module.exports = createChatController;
module.exports.deleteChatForUserController = deleteChatForUserController;
