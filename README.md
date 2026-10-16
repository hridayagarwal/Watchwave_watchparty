# WatchWave 🌊
**An immersive, real-time spatial watch-party experience.**

WatchWave is a synchronized watch-party web application featuring a stunning, VisionOS-inspired "Spatial UI." Built with heavy glassmorphism, dynamic glowing docks, and abstract animated backgrounds, WatchWave brings your crew together to watch YouTube videos in perfect sync—no matter where you are.

## ✨ Features

### 🖥️ The Spatial UI
- **Glassmorphic Floating Islands:** The interface is broken into functional, semi-transparent "wings" for Discover/Queue and Social/Chat, surrounding a massive central theater stage.
- **Dynamic Dock:** A bottom-anchored control pill handles playback, resyncing, and polling, keeping the interface clean and immersive.
- **Abstract Depth:** Smooth, animated ambient orbs and frosted glass layers provide a modern, desktop-class application feel directly in the browser.

### 🎬 Synchronized Viewing
- **YouTube IFrame Integration:** Plays any embeddable YouTube video or trailer.
- **Host Controls:** The room host holds the remote. When they play, pause, or seek, the entire room syncs instantly.
- **Intelligent Drift Correction:** Guests continuously compare their local playback time against the host's broadcast. If a guest's video drifts by more than 300ms, WatchWave automatically corrects it to keep the whole room on the same beat.
- **Pass the Remote:** The host can seamlessly transfer playback control to any other user in the room.

### 💬 Interactive Social Wing
- **Real-Time Chat:** A dedicated comms channel built on Socket.IO for instant messaging.
- **Live Reactions:** Users can trigger emoji reactions (😂, 🔥, 🤯, 🍿, ❤️) that physically float up across the central theater screen.
- **Democracy via Polls:** The host can launch live room polls to let the crew vote on what to watch next. Votes update in real-time.
- **Shared Queue:** Anyone can search the curated catalog or paste a custom YouTube URL to add to the "Up Next" playlist.

---

## 🚀 Getting Started

### Prerequisites
You need **Node.js (v18+)** and **npm** installed on your machine.

### Installation

1. Clone or extract the repository.
2. Open your terminal and navigate to the project directory:
   ```bash
   cd watchwave
