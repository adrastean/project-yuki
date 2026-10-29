// Use the developer's local icon only when it exists; never require or publish it.
// Geliştiricinin yerel simgesi varsa kullan; yokluğunda derlemeyi durdurma ve simgeyi repoya koyma.
const fs = require("node:fs");
const packageJson = require("./package.json");

const config = structuredClone(packageJson.build);
const localIcon = "build/iconyuki.ico";

if (fs.existsSync(localIcon)) {
  config.win = { ...config.win, icon: localIcon };
  config.extraResources.push({ from: localIcon, to: "yuki-runtime/iconyuki.ico" });
}

module.exports = config;
