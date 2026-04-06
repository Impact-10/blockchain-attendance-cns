const { sha256 } = require("./crypto");

function hashRecord(record) {
  return sha256(JSON.stringify(record));
}

function buildMerkleRoot(leafHashes) {
  if (!leafHashes.length) {
    return sha256("EMPTY");
  }

  let level = [...leafHashes];
  while (level.length > 1) {
    const nextLevel = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] || left;
      nextLevel.push(sha256(left + right));
    }
    level = nextLevel;
  }

  return level[0];
}

function buildMerkleRootFromRecords(records) {
  const leafHashes = records.map(hashRecord);
  return buildMerkleRoot(leafHashes);
}

module.exports = {
  hashRecord,
  buildMerkleRoot,
  buildMerkleRootFromRecords
};
