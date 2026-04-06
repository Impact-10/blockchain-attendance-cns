const { sha256 } = require("./crypto");

function hashBlock(blockData) {
  const payload = `${blockData.index}|${blockData.timestamp}|${blockData.merkle_root}|${blockData.previous_hash}`;
  return sha256(payload);
}

function createGenesisBlock() {
  const genesis = {
    index: 0,
    timestamp: new Date(0).toISOString(),
    merkle_root: sha256("GENESIS"),
    previous_hash: "0"
  };
  genesis.hash = hashBlock(genesis);
  return genesis;
}

function appendBlock(chain, merkleRoot) {
  const previous = chain[chain.length - 1];
  const block = {
    index: previous.index + 1,
    timestamp: new Date().toISOString(),
    merkle_root: merkleRoot,
    previous_hash: previous.hash
  };
  block.hash = hashBlock(block);
  chain.push(block);
  return block;
}

function verifyChain(chain) {
  if (!Array.isArray(chain) || chain.length === 0) {
    return false;
  }

  for (let i = 1; i < chain.length; i += 1) {
    const current = chain[i];
    const previous = chain[i - 1];
    const expectedHash = hashBlock(current);

    if (current.previous_hash !== previous.hash) {
      return false;
    }

    if (current.hash !== expectedHash) {
      return false;
    }
  }

  return true;
}

module.exports = {
  createGenesisBlock,
  appendBlock,
  verifyChain
};
