#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("Dundra [--start-only]\nUpdates from the configured Git upstream, then starts Dundra. --start-only skips Git.");
  process.exit(0);
}

function command(program, parameters, capture = false) {
  return spawnSync(program, parameters, {
    cwd: root, encoding: "utf8", stdio: capture ? ["ignore", "pipe", "ignore"] : "inherit",
  });
}

function requireSuccess(result, action) {
  if (result.status !== 0) throw new Error(action + " failed." + (result.error ? " " + result.error.message : ""));
}

function updateSource() {
  const checkout = command("git", ["rev-parse", "--show-toplevel"], true);
  if (checkout.status !== 0 || realpathSync(checkout.stdout.trim()) !== realpathSync(root)) {
    console.log("No Dundra Git checkout here. Starting the installed copy.");
    return;
  }
  const upstream = command("git", ["rev-parse", "--abbrev-ref", "@{upstream}"], true);
  if (upstream.status !== 0) {
    console.log("This branch has no Git upstream. Starting the local copy.");
    return;
  }
  const status = command("git", ["status", "--porcelain"], true);
  requireSuccess(status, "Checking the checkout");
  if (status.stdout.trim()) {
    console.log("Local changes found. Skipping the update and starting the local copy.");
    return;
  }
  if (command("git", ["pull", "--ff-only"]).status !== 0) {
    console.warn("Git could not fast-forward. Starting the local copy.");
  }
}

try {
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Install Node.js 24 or newer to run Dundra.");
  if (!args.includes("--start-only")) updateSource();

  const next = join(root, "node_modules", "next", "dist", "bin", "next");
  const stamp = join(root, "node_modules", ".dundra-lock");
  const lock = createHash("sha256").update(readFileSync(join(root, "package-lock.json"))).digest("hex");
  if (!existsSync(next) || !existsSync(stamp) || readFileSync(stamp, "utf8") !== lock) {
    const install = process.platform === "win32"
      ? command("cmd.exe", ["/d", "/c", "npm ci"])
      : command("npm", ["ci"]);
    requireSuccess(install, "Installing Dundra’s dependencies");
    writeFileSync(stamp, lock);
  }

  requireSuccess(command(process.execPath, [next, "build"]), "Building Dundra");
  console.log("Open Dundra at http://127.0.0.1:3000/");
  const server = command(process.execPath, [next, "start", "--hostname", "127.0.0.1"]);
  if (server.signal === "SIGINT") process.exitCode = 130;
  else requireSuccess(server, "Starting Dundra");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
