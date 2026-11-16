# Setting up Unreal Engine + Claude Code on your Mac mini

This guide connects **Claude Code** on your Mac to **Unreal Engine 5** through Epic's official **Unreal MCP** plugin. When it's done, Claude can build in the Unreal Editor for you: terrain, forest, lighting, mist, sound and clickable plants and animals.

Total time: about 2–3 hours, mostly downloads. Nothing here costs money.

> Checked against the official pages on 16 Nov 2026: Epic's *Unreal MCP in Unreal Editor* docs, Epic's *macOS Development Requirements*, Epic's *Unreal Engine Skills for Claude Code* plugin, and Anthropic's Claude Code setup docs. Software changes quickly; if a step doesn't match what you see, the links in [Sources](#sources) have the current version.

---

## What you'll end up with

```
Mac mini
├── Unreal Editor (5.8 or newer)  ──┐
│     └── Unreal MCP plugin         │  local connection only
│         (server on 127.0.0.1:8000)│  (never leaves your Mac)
└── Claude Code  ───────────────────┘
      └── Epic's "Unreal Engine Skills" plugin
```

**Important:** this only works with Claude running **on your Mac**. The cloud session that built the web demo can't reach your Unreal Editor, and it shouldn't: Epic's server has no password, so it must stay local.

---

## Step 0 – Before you start (10 min)

- [ ] **Check your macOS version:** Apple menu → *About This Mac*. Unreal 5.8 needs **macOS Sonoma 14.5 or newer**; Epic recommends macOS Sequoia 15. If your Mac shipped with a newer macOS (e.g. macOS 26), check Epic's requirements page for the Unreal version you install. Early macOS 26 releases had problems with some Unreal/Xcode combinations.
- [ ] **Free up space.** You need roughly **150–300 GB** for Unreal, the asset libraries and the project. A base Mac mini (256 GB) can't hold that, so get an **external SSD**: 2 TB NVMe in a USB4/Thunderbolt enclosure is ideal.
- [ ] **Format the SSD as APFS:** open *Disk Utility*, select the drive, *Erase*, Format **APFS**, Name **NimbaSSD**.
- [ ] Create these folders on the SSD:
  ```
  /Volumes/NimbaSSD/UnrealEngine      ← the engine itself
  /Volumes/NimbaSSD/NimbaProjects     ← your Unreal project(s)
  ```

## Step 1 – Install Xcode (30–60 min, mostly download)

Unreal uses Apple's developer tools on the Mac.

1. Install **Xcode 26.1.x** (Epic's recommended version for Unreal 5.8; minimum 26.0).
   **Do not use Xcode 26.4: Epic lists it as incompatible.** The Mac App Store always gives you the newest Xcode. For a specific version, download it from Apple's developer site (*developer.apple.com → Downloads → More*, free Apple account).
2. Open Xcode once, accept the licence, and let it install its components.
3. In Terminal, run:

```bash
xcode-select --install
```

(If it says the tools are already installed, that's fine.)

## Step 2 – Install Unreal Engine (45–90 min, mostly download)

1. Create a free **Epic Games account**, then download and install the **Epic Games Launcher for Mac** from *unrealengine.com*.
2. In the Launcher: **Unreal Engine** tab → **Library** → **+** next to *Engine Versions* → choose **5.8** (or the newest 5.x) → **Install**.
3. When it asks for an install location, choose **`/Volumes/NimbaSSD/UnrealEngine`**.
4. In the version's options, you don't need extra target platforms (Android, iOS, Linux) for now. Leave them off to save space.

## Step 3 – Create the project (10 min)

1. Launch Unreal Engine 5.8 from the Launcher.
2. Choose **Film / Video & Live Events → Blank**, or **Games → Blank**. Either works; Film/Video starts with better default lighting for cinematic scenes.
3. Settings:
   - **Blueprint** (not C++). You can add C++ later; Blueprint avoids compiling for now.
   - **Desktop**, **Maximum quality**, **No starter content**.
   - Location: `/Volumes/NimbaSSD/NimbaProjects`
   - Name: **NimbaWorld**
4. Click **Create**.

**Settings for a base Mac mini** (once the editor is open):
- *Settings* (top right of the viewport) → **Engine Scalability Settings** → start at **High**. Drop to **Medium** if the editor feels slow.
- Lumen (realistic lighting) works on Apple Silicon. Nanite (very detailed geometry) is **beta on Apple Silicon M2 and newer**. If your Mac mini has an M4 or newer chip it qualifies, but expect the occasional glitch.
- Close other heavy apps (browser tabs, video) while Unreal is open: 16 GB of memory goes fast.

## Step 4 – Enable Unreal MCP (10 min)

1. In the editor: **Edit → Plugins**.
2. Search **`MCP`** → enable **Unreal MCP** → click **Yes** on the "experimental" warning.
3. Search **`All Toolsets`** → enable it. Without it, the server exposes no tools to Claude.
4. Click **Restart Now**.
5. After the restart, open the **Output Log** (*Window → Output Log*). In the **Cmd** box at the bottom, type:

```
ModelContextProtocol.StartServer
```

6. The Output Log should show that the MCP server started (port **8000**).
7. **Make it start automatically:** *Edit → Editor Preferences → Model Context Protocol → Auto Start Server* ✓.
8. **Create Claude's connection file:** in the same Cmd box, type:

```
ModelContextProtocol.GenerateClientConfig ClaudeCode
```

This writes a `.mcp.json` file with the right address. (Epic's tutorial writes the last word as `Claude`; Epic's plugin README uses `ClaudeCode`. If one isn't recognised, try the other.) Note which folder the Output Log says it wrote it to; it should be the project folder `/Volumes/NimbaSSD/NimbaProjects/NimbaWorld`.

## Step 5 – Install Claude Code (10 min)

Pick **one** of these:

**A. Terminal (recommended).** Open *Terminal* and run Anthropic's installer:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

or, if you use Homebrew:

```bash
brew install --cask claude-code
```

Then sign in by running `claude` and following the browser prompts.

**B. Claude desktop app.** Download the **Claude** app for Mac from *claude.ai/download*, sign in, and use its **Code** tab. It runs Claude Code without the terminal.

## Step 6 – Connect Claude to Unreal (5 min)

1. Keep the Unreal Editor **open**, with the server started (Step 4).
2. In Terminal, go to the project folder and start Claude there:

```bash
cd /Volumes/NimbaSSD/NimbaProjects/NimbaWorld
```

```bash
claude
```

   (Desktop app: open that same folder as the project.)
3. Claude Code finds the `.mcp.json` file and asks whether to trust the **unreal-mcp** server. Approve it.

**If there's no `.mcp.json`** (or Claude doesn't offer it), add the server by hand in Terminal, from the project folder:

```bash
claude mcp add --transport http unreal-mcp http://127.0.0.1:8000/mcp
```

## Step 7 – Add Epic's Unreal skills for Claude (5 min)

This official plugin teaches Claude how to use the Unreal tools well. Inside Claude Code, type:

```
/plugin install unreal-engine-skills-for-claude-code@claude-plugins-official
```

If it says the marketplace isn't found, run this first, then the install command again:

```
/plugin marketplace add anthropics/claude-plugins-official
```

## Step 8 – Test the connection (5 min)

In Claude Code:

1. Type **`/plugin`**: the *Installed* tab should list **unreal-engine-skills-for-claude-code** as enabled.
2. Type **`/mcp`**: **unreal-mcp** should show as connected.
3. Ask:
   > List all actors in the current level.

   Claude should answer with the objects in your Unreal level (lights, sky, floor…).
4. Then try a tiny change:
   > Add a cube 2 metres above the floor in the middle of the level.

   You should see the cube appear in the editor. Undo with **Cmd + Z** in Unreal.

If all four work, **you're connected.** Tell me in this conversation and we'll plan the first real build.

---

## Safety rules (from Epic, worth following)

- **Keep the server local.** Don't change Unreal's network settings to make it reachable from other computers. It has no password: any program on your Mac can control the editor through it.
- **Don't run Claude Code with `--dangerously-skip-permissions`** while it's connected to Unreal. Approve Claude's actions as they come. One of Epic's tools runs Python inside the editor and can change or delete a lot at once.
- **Save before big sessions:** *File → Save All*, then make a copy of the project folder (or commit it to version control, see below), so you can always go back.
- **Turn the server off when you're not using it:** close the editor, or untick *Auto Start Server*.
- Only install Unreal plugins and Claude plugins from trusted sources (Epic, Anthropic's official marketplace).

## Backing up the Unreal project

Unreal projects are large binary files, so normal Git isn't enough:
- **Now (simple):** before each work session, copy `NimbaWorld` to `NimbaWorld-backup-YYYY-MM-DD` on the SSD. Time Machine can back up the external drive as well.
- **Later (proper):** a private GitHub repository with **Git LFS** (large-file storage), or Perforce, which many Unreal studios use. I can set this up with you when the project grows.

Keep the Unreal project **separate** from the web demo's repository (`Virtual-Museum`). The web repo will hold the data pack (terrain, tree heights, species database) that the Unreal project imports.

## Free realistic assets (when we start building)

Quixel Megascans (photoreal plants, rocks, ground) are now on **Fab**, inside the editor: *Window → Fab* (or the Fab button in the toolbar). Sign in with your Epic account, then add assets to the project. Check each asset's licence on Fab. Megascans are free to use in Unreal projects.

Don't download everything: we'll pick only what the Nimba zones need, to save space.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `/mcp` shows unreal-mcp as **failed** | The editor isn't open, or the server isn't started. Run `ModelContextProtocol.StartServer` in the Output Log Cmd box (or enable *Auto Start Server*), then restart Claude Code. |
| Connected, but Claude says there are **no tools** | Enable the **All Toolsets** plugin (Step 4) and restart the editor. |
| "Port already in use" | Another program (or a second Unreal editor) uses port 8000. Run `ModelContextProtocol.StartServer 8001`, then run `ModelContextProtocol.GenerateClientConfig ClaudeCode` again and restart Claude Code. |
| Claude doesn't see the server | Start Claude **from the project folder** (Step 6), or add it by hand with `claude mcp add …`. |
| Unreal won't open or crashes on start | Check your macOS and Xcode versions against Epic's requirements. **Xcode 26.4 is not compatible.** Keep Xcode 26.1.x. |
| The editor is very slow | Engine Scalability → **Medium**; close other apps; make sure the project is on the SSD, not a nearly full internal disk. |
| `claude: command not found` after installing | Close Terminal and open a new window, or use the desktop app instead. |

## What happens next

1. **Here (cloud session):** stage 1, the research and data pack.
   - Nimba terrain as 16-bit heightmaps at Unreal's landscape sizes.
   - Tree-height and vegetation masks for the forest generator.
   - A species and facts database in French and English.
   - All of it pushed to the `Virtual-Museum` GitHub repo.
2. **On your Mac:** pull that data pack. Claude, connected to Unreal through this setup, builds the first photoreal zone: about 1 km² of the summit grasslands and cloud-forest edge around Mont Richard-Molard.

---

## Sources

- Epic, *Unreal MCP in Unreal Editor*: https://dev.epicgames.com/documentation/unreal-engine/unreal-mcp-in-unreal-editor
- Epic, *Using the Unreal Engine 5 MCP Server with Claude Code, Codex CLI, and Cursor*: https://dev.epicgames.com/community/learning/tutorials/DEKE/using-the-unreal-engine-5-mcp-server-with-claude-code-codex-cli-and-cursor
- Epic, *Unreal Engine Skills for Claude Code* plugin: https://github.com/EpicGames/unreal-engine-skills-for-claude-code-plugin
- Epic, *macOS Development Requirements for Unreal Engine*: https://dev.epicgames.com/documentation/unreal-engine/macos-development-requirements-for-unreal-engine
- Anthropic, *Claude Code setup*: https://code.claude.com/docs/en/setup
