# VibraLink

Stream your PC audio to your phone over your local network.  
No accounts. No cloud. No unnecessary complexity.

---

## ✨ Overview

VibraLink is a lightweight Windows desktop application that allows you to stream system audio from your PC directly to your phone using your browser.

It is designed to be simple, fast, and completely local — your audio never leaves your network.

---

## 🤖 Development Note

This project was initially built with the help of OpenAI Codex.

What started as an experiment — exploring how quickly a functional system could be built using AI — turned into something that actually works and may be useful to others.

VibraLink was never originally intended as a "serious" product, but after seeing it in action, it has evolved into a practical tool that will continue to be improved over time.

Going forward:
- The project will be actively maintained and refined
- Features and improvements will be based on real-world usage
- Feedback, issues, and contributions are welcome

AI was used as a tool to accelerate development, but the project is actively reviewed and developed further by me.

---

## 🚀 Features

- Stream Windows system audio (WASAPI loopback)
- Select audio input device (choose what to capture)
- Quality modes:
  - Low latency
  - Balanced
  - High quality
- Low-latency playback using WebRTC
- Works in any modern phone browser
- Local network only (privacy-friendly)
- Simple desktop interface

---

## 📦 Download

Download the latest Windows installer from the **Releases** section.

---

## 🛠️ How to Use

1. Install and open VibraLink  
2. Select your audio input device  
3. Choose a quality mode  
4. Click **Start Streaming**  
5. Open the displayed URL on your phone (same WiFi network)  
6. Tap connect and start listening  

---

## 🎧 DAW Usage (Important)

VibraLink works best with standard Windows audio paths (WASAPI shared).

### ⚠️ Limitation

ASIO-based audio (used by many DAWs) cannot be captured directly due to how Windows audio drivers work.

### ✅ Recommended Workflows

For DAW monitoring:

**Option 1 (simplest):**
- Switch your DAW audio driver to **WASAPI (shared)**

**Option 2 (recommended for flexibility):**
- Use a virtual audio device (e.g. VB-CABLE)
- Route DAW output → virtual device → VibraLink

This ensures VibraLink can properly capture and stream your audio.

This will be fixed in the future!

---

## 🧠 How It Works

VibraLink captures system audio using Windows loopback (WASAPI), encodes it, and streams it over your local network using WebRTC.

Your phone connects through a simple web interface served by the desktop app.

---

## ⚠️ Known Limitations

- ASIO audio cannot be captured directly
- Performance may vary depending on network quality
- Very low latency modes may reduce audio quality slightly

---

## 🔓 Open Source

VibraLink is an open-source project.

- You are free to view, use, modify, and distribute the code in accordance with the included license
- The project is intended to be transparent and accessible

Please note:
- Framefield is not responsible for modified or redistributed versions
- Only download official builds from this repository’s release page

---

## ⚠️ Disclaimer

This software is provided **"as is"**, without warranty of any kind.

Framefield is not liable for any damage, data loss, or issues resulting from the use of this software or any modified versions.

---

## ❤️ Support

If you find VibraLink useful and want to support development:

👉 [[Ko-fi link here]](https://ko-fi.com/wtchtwr)

Donations help support continued improvements and new features.

No pressure — just using VibraLink is already appreciated.

---

## 🧩 Contributing

Contributions, suggestions, and improvements are welcome.

Feel free to:
- open issues
- submit pull requests
- share ideas

---

## 📌 Project Status

Active — ongoing improvements and refinements.

---

## 👤 Author

Developed by **Jayden / Framefield**
