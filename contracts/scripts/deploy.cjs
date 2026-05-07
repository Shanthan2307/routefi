const hre = require("hardhat");

async function main() {
  const BiteIntentStore = await hre.ethers.getContractFactory("BiteIntentStore");
  const store = await BiteIntentStore.deploy();
  await store.waitForDeployment();

  const address = await store.getAddress();
  console.log(`BiteIntentStore deployed to: ${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
