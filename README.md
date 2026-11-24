# Dundra

First off, this is fully vibe-coded. I didn’t really want to waste time here.

I made this because I like how easy Jan\*\*\*\*.ai is to set up (yk yk), but I find it restrictive, and there are fewer and fewer bots I actually like. Some of the stuff I’ve seen on the SillyTavern subreddit had me baffled. I’m here for adventure, worldbuilding, and that kind of thing.

So I made Dundra. It’s my mix of Jan\*\*\*\*.ai and SillyTavern. Easy to set up, easy to use, with HTML, image and audio input, and regex. Group chats, extensions, and image generation are on my list.

## Install and run

1. Install [Git](https://git-scm.com/install/) and [Node.js](https://nodejs.org/en/download) 24 or newer. The Node.js installer includes npm.
2. Open a terminal in the folder where you want Dundra installed.
3. Clone the repository, install its dependencies, and start it.

```sh
git clone https://github.com/Ans-yt/Dundra.git
cd Dundra
npm ci
npm run build
npm start
```

If PowerShell blocks the npm script shim, use `npm.cmd` in place of `npm`. To launch again, run `npm start` from the Dundra folder.

Open [Dundra](http://127.0.0.1:3000/). Dundra runs on your own machine and is intended for one local user. The first-run walkthrough helps you choose a default persona. You can also set a local account password, or skip that step. Each browser stays signed in while the server is running and asks again after a restart. Change your default persona later under **Personas**.

On Windows, double-click **Start.cmd** to launch the installed copy, or **Update & Start.cmd** to pull updates from the configured Git upstream first. The updater skips Git if the folder came from a ZIP, the branch has no upstream, or you have local changes.

On Linux, run `./start.sh` to launch or `./update-and-start.sh` to pull updates first.

For a terminal shortcut, run `npm link` once from this directory. Then type `Dundra` in a Windows terminal or `dundra` on macOS and Linux to update and start. Use `npm run dev` for development.

In **Settings → Model**, enter your OpenAI-compatible provider’s base URL, the model ID, and an API key if the provider requires one. You can also set defaults in `.env.local` using [the example](.env.example). Image and audio input depend on the model. Turn on audio attachments in **Settings → Advanced**.

## What’s in it

- A searchable character library, optional chat names, personas, and character-card import and export as JSON or PNG.
- Streaming chat with swipes, continue, impersonation drafts, and SillyTavern JSONL import and export.
- Lorebooks, prompt presets, regex scripts, HTML message formatting, and optional automatic chat summaries and Lorebook memory.
- Experimental lorebook images can send up to three images from a matching entry when inline media is enabled.
- Local storage in `data/`. API keys and chat history live there. Requests send the relevant chat context and supported attachments to the provider you configure.

## Checks

```sh
npm run typecheck
```

## License and credits

Dundra is licensed under [GNU AGPL v3](LICENSE), the same license as SillyTavern.

The navigation uses [Gentleface icons](https://gentleface.com/) under the [MIT license](LICENSE-Gentleface).
