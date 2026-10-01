# Chat side panel

A small communication app built on the [Side Panel API](https://developer.chrome.com/docs/extensions/reference/sidePanel/).

## Features

- Chat UI in the side panel, opened from the toolbar icon.
- Messages are stored in `chrome.storage.local`; `storage.onChanged` keeps every
  open window's panel in sync in real time.
- Optional WebSocket relay: enter a `ws://` or `wss://` URL in the header and
  messages are sent to and received from other users connected to the same
  server. Any server that broadcasts each received JSON frame to all clients
  works (for example an echo/broadcast server).

Message frame format:

```json
{ "id": "uuid", "senderId": "uuid", "name": "Ada", "text": "hi", "time": 1700000000000 }
```

Messages are de-duplicated by `id`, so a server that echoes frames back is fine.

## Running this extension

1. Clone this repository.
2. Load this directory in Chrome as an [unpacked extension](https://developer.chrome.com/docs/extensions/mv3/getstarted/development-basics/#load-unpacked).
3. Click the extension's toolbar icon to open the chat.
