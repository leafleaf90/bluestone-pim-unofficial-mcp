# Setup guide: no technical experience required

This guide takes you from a brand new Mac to having Claude Desktop talk directly to Bluestone PIM. Follow every step in order and you'll be up and running.

---

## What you're setting up

There are two ways to connect Claude to Bluestone PIM:

**Option A: Local setup (this guide, Steps 1–10)**
You install a small bridge program on your Mac. When Claude Desktop starts, it runs the bridge automatically in the background. Nothing runs in the cloud; everything stays on your Mac.

**Option B: Hosted version (skip to the bottom of this page)**
No installation needed. You connect Claude Desktop or Cursor directly to a server already running in the cloud. All you need are your Bluestone credentials.

---

## Step 1: Install an IDE (code editor)

An IDE is just a program for opening and editing code files. You need it to edit one configuration file later. Pick one:

**Option A: Visual Studio Code** (most popular, free)
1. Go to [code.visualstudio.com](https://code.visualstudio.com)
2. Click **Download for Mac**
3. Open the downloaded file and drag VS Code to your Applications folder

**Option B: Cursor** (similar to VS Code, has built-in AI)
1. Go to [cursor.com](https://cursor.com)
2. Click **Download** and follow the same steps

Either one works fine. VS Code is the safe default if you're unsure.

---

## Step 2: Install Node.js

Node.js is what actually runs the bridge program. Think of it as the engine.

1. Go to [nodejs.org](https://nodejs.org)
2. Click the big **LTS** button (the one that says "Recommended for most users")
3. Open the downloaded file and follow the installer. Just click Continue and Install through all the steps
4. When it finishes, close the installer

---

## Step 3: Open a Terminal

The Terminal is a text-based way to give your Mac instructions. It looks intimidating but you're only going to type a few commands, and they're provided for you below.

To open Terminal:
- Press **Command + Space** to open Spotlight
- Type `Terminal` and press Enter

A window opens with a blinking cursor. That's it. You're in the Terminal.

---

## Step 4: Verify Node.js installed correctly

In the Terminal, type this exactly and press Enter:

```
node --version
```

You should see something like `v22.0.0` (the number may differ). If you see a number, Node.js is installed correctly. If you see an error, go back to Step 2 and try the installer again.

---

## Step 5: Get the project files

You should have received a folder called `bluestone-unofficial-mcp`. Place it somewhere permanent on your Mac. Your Documents folder is a good choice.

For example, your folder structure should look something like:

```
Documents/
└── bluestone-unofficial-mcp/
    ├── src/
    ├── docs/
    ├── package.json
    └── ...
```

Do not move this folder after completing setup, as Claude Desktop will look for it in the location you configure.

---

## Step 6: Add your API key

1. Open the `bluestone-unofficial-mcp` folder in your IDE (VS Code or Cursor)
   - In VS Code: go to **File → Open Folder** and select `bluestone-unofficial-mcp`
2. Find the file called `.env` in the file list on the left
   - If you don't see it, make sure hidden files are visible: in VS Code press **Command + Shift + P**, type `toggle hidden`, and select **Toggle Hidden Files**
3. Open `.env`. It looks like this:
   ```
   PAPI_KEY=your-papi-key-here
   ```
4. Replace `your-papi-key-here` with the actual API key you were given
5. Save the file (**Command + S**)

The file should now look like:
```
PAPI_KEY=theActualKeyYouWereGiven
```

---

## Step 7: Run the setup commands

Go back to Terminal. You need to navigate to the `bluestone-unofficial-mcp` folder. Type this command but replace the path with wherever you actually put the folder:

```
cd ~/Documents/bluestone-unofficial-mcp
```

The `cd` command means "go to this folder". Press Enter.

Now run these two commands, one at a time, pressing Enter after each:

```
npm install
```

This downloads the code libraries the bridge needs. Wait for it to finish; it may take 30 seconds. You'll see a lot of text scroll past, that's normal.

```
npm run build
```

This compiles the bridge program so it's ready to run. When it finishes with no errors, you're done with the Terminal.

---

## Step 8: Install Claude Desktop

If you don't have Claude Desktop yet:

1. Go to [claude.ai/download](https://claude.ai/download)
2. Download and install the Mac app
3. Sign in with your Anthropic account

---

## Step 9: Connect the bridge to Claude Desktop

This is the one step where you edit a configuration file. This tells Claude Desktop where to find your bridge program.

1. Open your IDE (VS Code or Cursor)
2. Go to **File → Open File**
3. Press **Command + Shift + G** to type a path directly
4. Paste this path and press Enter:
   ```
   ~/Library/Application Support/Claude/claude_desktop_config.json
   ```
5. The file opens. It contains some settings already. You need to add the `mcpServers` section to it.

Find the last `}` at the very end of the file. Before it, add a comma after the previous closing `}` and paste in the new section. The end of your file should look like this:

```json
  },
  "mcpServers": {
    "bluestone-pim": {
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/Documents/bluestone-unofficial-mcp/build/index.js"],
      "env": {
        "PAPI_KEY": "theActualKeyYouWereGiven"
      }
    }
  }
}
```

**Important:** Replace `YOUR_USERNAME` with your actual Mac username. If you're not sure what it is, open Terminal and type `whoami`. It will print your username.

Also replace `theActualKeyYouWereGiven` with your real API key (same one from Step 6).

6. Save the file (**Command + S**)

---

## Step 10: Restart Claude Desktop and verify

1. Quit Claude Desktop completely: right-click its icon in the Dock and choose **Quit**
2. Relaunch Claude Desktop from your Applications folder
3. In the chat screen, click the **+** button in the message input bar
4. Select **Connectors**
5. You should see **bluestone-pim** listed with a blue toggle

If you see it with the blue toggle, you're done. The bridge is running.

---

## Try it out

Start a new chat in Claude Desktop and type:

> Show me the catalogs in Bluestone PIM

Claude will fetch the live data from your Bluestone account and show you the categories. From there you can ask it to list products in any category.

---

---

## Alternative: connect to the hosted version (no installation needed)

If you don't want to install anything locally, you can connect directly to the server that is already running in the cloud. You just need your Bluestone credentials.

---

### Connect via Claude Desktop

1. Open Claude Desktop
2. Go to **Settings** → **Customize** → **Connectors** → **Add custom connector**
3. Fill in the fields:
   - **Name**: `Bluestone PIM`
   - **URL**: `https://bluestone-mcp-unofficial.vercel.app/mcp`
4. Open **Advanced settings** and fill in:
   - **Client ID**: your MAPI Client ID and PAPI key joined with a colon, no spaces:
     ```
     your-mapi-client-id:your-papi-key
     ```
   - **Client Secret**: your MAPI Client Secret
5. Click **Add**

A browser window will open briefly and close on its own. That is the authorisation completing. Normal behaviour.

You should now see **Bluestone PIM** listed under Connectors with a blue toggle. Enable it and you're ready.

---

### Connect via Cursor

1. Open Cursor
2. Go to **Settings** → **MCP** (or edit `.cursor/mcp.json` directly)
3. Add the following:
   ```json
   {
     "mcpServers": {
       "bluestone-pim": {
         "type": "http",
         "url": "https://bluestone-mcp-unofficial.vercel.app/mcp"
       }
     }
   }
   ```
4. Save the file. Cursor will detect the new server and prompt you to connect.
5. A browser window opens with a **Connect to Bluestone PIM** form. Enter:
   - **MAPI Client ID**
   - **MAPI Client Secret**
   - **PAPI Key**
6. Click **Authorise**. The browser closes and Cursor finishes connecting automatically.

---

## Something went wrong?

**bluestone-pim doesn't appear under Connectors**
- Make sure you saved the `claude_desktop_config.json` file
- Make sure the path in the file matches exactly where your `bluestone-unofficial-mcp` folder actually is
- Quit and relaunch Claude Desktop again

**Claude says it can't find a tool or gives an error**
- Open Terminal, navigate to the folder (`cd ~/Documents/bluestone-unofficial-mcp`), and run `npm run build` again
- Restart Claude Desktop

**I'm not sure if the path is right**
- Open Terminal and type: `ls ~/Documents/bluestone-unofficial-mcp/build/index.js`
- If it prints the path without an error, the file exists and the path is correct
