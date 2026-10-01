# Talk: web chat, forum and video calls

A standalone communication app with its own Node server. No accounts: pick a display name and go.

- **Chat**: real-time rooms with presence and the last 100 messages per room.
- **Forum**: threads and replies, persisted to `data.json`; open pages update live.
- **Video**: group calls (up to 6 people per room) using WebRTC, with mute and camera toggles.

## Run

```
npm install
npm start        # http://localhost:3000  (PORT env var to change)
npm test         # smoke test for chat, forum and call signalling
```

Open the page in two tabs or devices to try it. Browsers only allow camera access on
`localhost` or HTTPS, so put the server behind HTTPS (for example a reverse proxy) for
use on other machines.

## How it works

- `server.js`: Express serves `public/` and the forum REST API (`/api/threads`);
  a WebSocket endpoint (`/ws`) carries chat, presence, forum-update notices and WebRTC signalling.
- Video is a peer-to-peer mesh: a newcomer sends offers to everyone already in the room;
  the server only relays SDP/ICE between members of the same room. Media never passes through it.
- Uses a public Google STUN server. Peers behind strict NATs need a TURN server; add it to
  `RTC_CONFIG` in `public/app.js`.

## Limitations

- No authentication, moderation or rate limiting beyond basic size limits and a per-connection chat throttle.
- Mesh video gets heavy beyond a handful of participants; use an SFU for larger calls.
- Storage is a single JSON file, suitable for demos and small groups.
