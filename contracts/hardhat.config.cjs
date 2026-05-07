require("@nomicfoundation/hardhat-toolbox");
require("dotenv/config");

/** @type {import("hardhat/config").HardhatUserConfig} */
const config = {
  solidity: "0.8.20",
  paths: {
    sources: "./src",
    cache: "./cache",
    artifacts: "./artifacts",
  },

  networks: {
    skaleCalypso: {
      url: "https://testnet.skalenodes.com/v1/giant-half-dual-testnet",
      chainId: 974399131,
      accounts: process.env.SKALE_PRIVATE_KEY
        ? [process.env.SKALE_PRIVATE_KEY]
        : [],
    },
    skaleBaseSepolia: {
      url: "https://base-sepolia-testnet.skalenodes.com/v1/base-testnet",
      chainId: 324705682,
      accounts: process.env.SKALE_PRIVATE_KEY
        ? [process.env.SKALE_PRIVATE_KEY]
        : [],
    },
    skaleBaseMainnet: {
      url: "https://skale-base.skalenodes.com/v1/base",
      chainId: 1187947933,
      accounts: process.env.SKALE_PRIVATE_KEY
        ? [process.env.SKALE_PRIVATE_KEY]
        : [],
    },
  },
};

module.exports = config;
