# photogal Capture One Pro Integration

Native export and publishing integration for Phase One / Capture One Pro (macOS), allowing photographers to publish photos directly to **photogal** client galleries with one click.

---

## 🚀 Features

- **Direct In-App Export**: Publishes directly from Capture One via `Image -> Publish -> photogal` or via the Export tool.
- **Recipe "Open With" Support**: Compatible with any custom Export Recipe by setting *Open With* to `photogal`.
- **Universal Binary**: Compiled as a native Mach-O universal bundle supporting both **Apple Silicon (M1/M2/M3/M4)** and **Intel** Macs.
- **Dynamic Gallery Selection**: Automatically retrieves active galleries from your photogal server.
- **In-App Gallery Creation**: Create new galleries on-the-fly (title, shoot date, optional PIN) directly inside Capture One.
- **Real-Time Progress**: Native progress indicator in Capture One's Background Activity tool.
- **One-Click Link**: Directly opens the newly populated gallery in your default browser upon export completion.

---

## 📦 Quick Installation

### Option 1: One-Command Local Install (Recommended)
From the repository root, run:
```bash
./integrations/captureone/install.sh
```
This automatically compiles the plugin universal binary, copies it to `~/Library/Application Support/Capture One/Plug-ins/photogal.coplugin`, and installs the companion AppleScript.

### Option 2: In-App Web Admin Download
1. Open your **photogal** Admin panel (`/admin`).
2. Click **Capture One** in the top navigation bar.
3. Download `photogal.coplugin.zip` and double-click to install it into Capture One, or drag it into **Capture One -> Settings -> Plugins**.

---

## ⚙️ Configuration & Usage

1. Open **Capture One Pro**.
2. Select one or more photos in your catalog or session.
3. Choose **Image -> Publish -> photogal** (or select photogal in the Export panel).
4. Configure your settings:
   - **photogal Server URL**: e.g., `http://localhost:3000` or `https://galleries.yourstudio.com`
   - **API Token**: Generated from the photogal Admin panel (`pg_live_...`)
   - **Target Gallery**: Choose an existing gallery or select `[ + Create New Gallery ]`
5. Click **Publish**! Capture One will export the variants and stream them directly into photogal.

