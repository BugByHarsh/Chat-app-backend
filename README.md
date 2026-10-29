# Convo — Backend

REST API and authenticated Socket.IO server for the Convo chat app. Pairs with the [Convo Frontend](https://github.com/BugByHarsh/Chat-app-Frontend).

## Tech Stack

- **Node.js** + **Express**
- **MongoDB** + **Mongoose**
- **Socket.io** — real-time events and presence
- **JWT** — HTTP and Socket.IO authentication
- **bcryptjs** — password hashing
- **Google Auth Library** — Google OAuth verification

## Getting Started

```bash
git clone https://github.com/BugByHarsh/Chat-app-backend.git
cd Chat-app-backend
npm install
```

Create a `.env` file in the root:

```env
MONGO_URL=your_mongodb_connection_string
SECRET_KEY=your_long_random_jwt_secret
GOOGLE_CLIENT_ID=your_google_client_id
FRONTEND_URL=http://localhost:5173
PORT=5000
```

`FRONTEND_URL` can contain comma-separated allowed web origins. If omitted, CORS allows any origin; set it explicitly in production. HTTP and Socket.IO use JWT bearer authentication, not cookies.

Run the server with:

```bash
npm start
```

## Security behavior

- Message history and sending require the authenticated user to belong to the requested chat.
- Message content is trimmed and capped at 5,000 characters.
- Socket.IO verifies the JWT during connection; the server derives the user ID from the token rather than trusting a client-supplied ID.
- Typing and read-receipt events validate chat membership and derive recipients from the chat.
- Presence supports multiple active sockets per account.

## API Reference

### Auth — `/user`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/register` | Register with email/password |
| POST | `/api/login` | Login with email/password |
| POST | `/api/google-login` | Login or register via Google OAuth |
| GET | `/api/tokenVerify` | Verify JWT and return user + chats |
| GET | `/api/getSearchedUser?q=` | Search user by username or email |
| POST | `/api/edit` | Update profile (name, username, email) |

### Chats — `/chat`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/getAllChats` | List current user's chats; create/open a direct chat with `{ "userId": "..." }` |

### Messages — `/msg`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/` | Send a message with `{ "chatID": "...", "content": "..." }` |
| GET | `/:chatID` | Get paginated messages (`?before=<messageId>`) |

## Socket Events

All connections must provide the JWT in the Socket.IO handshake auth object: `{ token: "<JWT>" }`.

| Event | Direction | Description |
|-------|-----------|-------------|
| `isTyping` | Client → Server | Notify chat participants that current user is typing; payload includes `chatId` |
| `stoppedTyping` | Client → Server | Notify chat participants typing stopped; payload includes `chatId` |
| `msgsRead` | Client → Server | Mark incoming messages as read; payload includes `chatId` |
| `getOnlineUsers` | Server → Client | Current online user IDs |
| `newMessage` | Server → Client | Deliver a new message |
| `newChat` | Server → Client | Notify a recipient about a newly created direct chat |
| `typing`, `stoppedTyping`, `markRead` | Server → Client | Typing and read-receipt updates |

## Deployment

Set these environment variables in your Render service:

```env
MONGO_URL=your_mongodb_connection_string
SECRET_KEY=your_long_random_jwt_secret
GOOGLE_CLIENT_ID=your_google_client_id
FRONTEND_URL=https://we-convo.vercel.app
PORT=5000
```

Use `npm start` as the start command.
