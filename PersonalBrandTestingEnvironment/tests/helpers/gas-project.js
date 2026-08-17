const fs = require("node:fs");
const path = require("node:path");

function readGasProjectSource(projectDirectory) {
  return fs
    .readdirSync(projectDirectory)
    .filter((name) => name.endsWith(".gs"))
    .sort()
    .map((name) => fs.readFileSync(path.join(projectDirectory, name), "utf8"))
    .join("\n");
}

module.exports = { readGasProjectSource };
