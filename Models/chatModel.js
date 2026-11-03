const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema(
    {
        chatName: { type: String, required: true },
        users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        latestMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
        groupAdmin: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        hiddenFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        clearedFor: [{
            user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
            clearedAt: { type: Date, required: true },
        }],
    },
    { timestamps: true }
);

chatSchema.index({ users: 1 });

const Chat = mongoose.model('Chat', chatSchema);
module.exports = Chat;