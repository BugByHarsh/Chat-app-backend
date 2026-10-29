const mongoose = require('mongoose');

const reactionSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    emoji: { type: String, required: true, maxlength: 16 },
}, { _id: false });

const messageSchema = new mongoose.Schema(
    {
        sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        content: { type: String, required: true, maxlength: 5000 },
        chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
        isRead: { type: Boolean, default: false },
        replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
        reactions: { type: [reactionSchema], default: [] },
        editedAt: { type: Date, default: null },
        deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

messageSchema.index({ chatId: 1, _id: -1 });
messageSchema.index({ chatId: 1, sender: 1, createdAt: -1 });

const Message = mongoose.model('Message', messageSchema);
module.exports = Message;
