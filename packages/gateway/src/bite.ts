import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BITE } from "@skalenetwork/bite";
import type { GatewayConfig } from "./config.js";
import { logger } from "./utils/logger.js";

export interface BiteServiceStatus {
  address: string;
  balance: string;
  balanceFormatted: string;
}

export interface BiteService {
  encryptIntent(intentId: string, data: Uint8Array): Promise<string>;
  triggerReveal(intentId: string): Promise<void>;
  getDecryptedIntent(intentId: string): Promise<Uint8Array | null>;
  getStatus(): Promise<BiteServiceStatus>;
}

const biteIntentStoreAbi = [
  {
    name: "storeIntent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "intentId", type: "bytes32" },
      { name: "encryptedBlob", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "markPaid",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "intentId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "onDecrypt",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "intentId", type: "bytes32" },
      { name: "plaintext", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "getIntent",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "intentId", type: "bytes32" }],
    outputs: [
      { name: "owner", type: "address" },
      { name: "paid", type: "bool" },
      { name: "revealed", type: "bool" },
      { name: "data", type: "bytes" },
    ],
  },
] as const;

export function createBiteService(config: GatewayConfig): BiteService | null {
  if (
    !config.skaleRpcUrl ||
    !config.skaleBiteContract ||
    !config.skalePrivateKey
  ) {
    logger.info("SKALE BITE not configured, encryption disabled");
    return null;
  }

  const rpcUrl = config.skaleRpcUrl;
  const contractAddress = config.skaleBiteContract as Address;
  const account = privateKeyToAccount(config.skalePrivateKey as Hex);

  const chain = config.skaleChainId
    ? {
        id: config.skaleChainId,
        name: "SKALE",
        nativeCurrency: { name: "CREDIT", symbol: "CREDIT", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      }
    : undefined;

  const transport = http(rpcUrl);

  const walletClient = createWalletClient({
    account,
    chain,
    transport,
  });

  const publicClient = createPublicClient({
    chain,
    transport,
  });

  const bite = new BITE(rpcUrl);

  // Cache plaintext per intentId so triggerReveal can call onDecrypt.
  // The BITE protocol should call onDecrypt automatically, but on testnets
  // the callback may not be wired up, so we call it ourselves after markPaid.
  const plaintextCache = new Map<string, Hex>();

  // Serialize all write transactions and manage nonces locally to prevent
  // nonce collisions when concurrent requests hit the same wallet.
  let txQueue: Promise<void> = Promise.resolve();
  let localNonce: number | null = null;

  async function nextNonce(): Promise<number> {
    if (localNonce !== null) return localNonce++;
    const n = await publicClient.getTransactionCount({ address: account.address });
    localNonce = n + 1;
    return n;
  }

  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = txQueue.then(fn, fn);
    txQueue = result.then(() => {}, () => {});
    return result;
  }

  logger.info("SKALE BITE service initialized", {
    rpcUrl,
    contract: contractAddress,
  });

  return {
    async encryptIntent(
      intentId: string,
      data: Uint8Array,
    ): Promise<string> {
      return enqueue(async () => {
        logger.debug("Encrypting intent", { intentId, size: data.length });

        const dataHex = `0x${Buffer.from(data).toString("hex")}` as Hex;
        plaintextCache.set(intentId, dataHex);

        const calldata = encodeFunctionData({
          abi: biteIntentStoreAbi,
          functionName: "storeIntent",
          args: [intentId as Hex, dataHex],
        });

        const encryptedTx = await bite.encryptTransaction({
          to: contractAddress,
          data: calldata,
        });

        const nonce = await nextNonce();
        const txHash = await walletClient.sendTransaction({
          to: encryptedTx.to as Address,
          data: encryptedTx.data as Hex,
          gas: encryptedTx.gasLimit ? BigInt(encryptedTx.gasLimit) : 300000n,
          nonce,
        });

        // Wait for tx confirmation so BITE decryption + contract execution completes
        await publicClient.waitForTransactionReceipt({ hash: txHash });

        logger.debug("Encrypted intent stored", { intentId, txHash });
        return txHash;
      });
    },

    async triggerReveal(intentId: string): Promise<void> {
      return enqueue(async () => {
        logger.debug("Triggering BITE reveal", { intentId });

        // Step 1: markPaid
        const nonce1 = await nextNonce();
        const paidHash = await walletClient.writeContract({
          address: contractAddress,
          abi: biteIntentStoreAbi,
          functionName: "markPaid",
          args: [intentId as Hex],
          nonce: nonce1,
        });
        await publicClient.waitForTransactionReceipt({ hash: paidHash });
        logger.debug("markPaid confirmed", { intentId, txHash: paidHash });

        // Step 2: Call onDecrypt with cached plaintext.
        // On production SKALE chains the BITE protocol calls this automatically;
        // we call it ourselves as a fallback for testnets where the callback
        // is not wired up.
        const plaintext = plaintextCache.get(intentId);
        if (plaintext) {
          const nonce2 = await nextNonce();
          const revealHash = await walletClient.writeContract({
            address: contractAddress,
            abi: biteIntentStoreAbi,
            functionName: "onDecrypt",
            args: [intentId as Hex, plaintext],
            nonce: nonce2,
          });
          await publicClient.waitForTransactionReceipt({ hash: revealHash });
          plaintextCache.delete(intentId);
          logger.debug("onDecrypt confirmed", { intentId, txHash: revealHash });
        }
      });
    },

    async getDecryptedIntent(
      intentId: string,
    ): Promise<Uint8Array | null> {
      logger.debug("Getting decrypted intent", { intentId });

      const [_owner, _paid, revealed, data] = await publicClient.readContract({
        address: contractAddress,
        abi: biteIntentStoreAbi,
        functionName: "getIntent",
        args: [intentId as Hex],
      });

      if (!revealed) {
        logger.debug("Intent not yet revealed", { intentId });
        return null;
      }

      return new Uint8Array(Buffer.from((data as string).slice(2), "hex"));
    },

    async getStatus(): Promise<BiteServiceStatus> {
      const balance = await publicClient.getBalance({ address: account.address });
      const formatted = (Number(balance) / 1e18).toFixed(2);
      return {
        address: account.address,
        balance: balance.toString(),
        balanceFormatted: formatted,
      };
    },
  };
}
