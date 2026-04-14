import {randomBytes} from "node:crypto";
import {bench, describe} from "@chainsafe/benchmark";
import {EFFECTIVE_BALANCE_INCREMENT, MAX_EFFECTIVE_BALANCE_ELECTRA, SLOTS_PER_EPOCH} from "@lodestar/params";
import {digest} from "@chainsafe/as-sha256";
import {computePtcIndices, computePtcIndicesForEpoch} from "../../index.js";

const PTC_SIZE = 512;

function computePtcIndicesJs(
  effectiveBalanceIncrements: Uint16Array,
  indices: Uint32Array,
  seed: Uint8Array
): Uint32Array {
  const MAX_RANDOM_VALUE = 0xffff;
  const MAX_EBI = MAX_EFFECTIVE_BALANCE_ELECTRA / EFFECTIVE_BALANCE_INCREMENT;
  const result = new Uint32Array(PTC_SIZE);
  let resultLen = 0;

  const hashInput = new Uint8Array(seed.length + 8);
  hashInput.set(seed, 0);
  const view = new DataView(hashInput.buffer, hashInput.byteOffset, hashInput.byteLength);
  const seedLen = seed.length;

  let i = 0;
  let randomBytesView: DataView = new DataView(new ArrayBuffer(0));
  let lastBlock = -1;

  while (resultLen < PTC_SIZE) {
    const candidateIndex = indices[i % indices.length];
    const block = i >>> 4;
    if (block !== lastBlock) {
      view.setUint32(seedLen, block, true);
      view.setUint32(seedLen + 4, 0, true);
      const rb = digest(hashInput);
      randomBytesView = new DataView(rb.buffer, rb.byteOffset, rb.byteLength);
      lastBlock = block;
    }
    const randomValue = randomBytesView.getUint16((i & 15) * 2, true);
    if (effectiveBalanceIncrements[candidateIndex] * MAX_RANDOM_VALUE >= MAX_EBI * randomValue) {
      result[resultLen++] = candidateIndex;
    }
    i++;
  }
  return result;
}

function computePtcForEpochJs(
  epochSeed: Uint8Array,
  startSlot: number,
  shuffling: Uint32Array,
  slotOffsets: Uint32Array,
  effectiveBalanceIncrements: Uint16Array
): Uint32Array {
  const result = new Uint32Array(SLOTS_PER_EPOCH * PTC_SIZE);
  const slotSeedInput = new Uint8Array(40);
  slotSeedInput.set(epochSeed, 0);
  const view = new DataView(slotSeedInput.buffer);

  for (let i = 0; i < SLOTS_PER_EPOCH; i++) {
    view.setUint32(32, startSlot + i, true);
    view.setUint32(36, 0, true);
    const slotSeed = digest(slotSeedInput);
    const slotIndices = shuffling.subarray(slotOffsets[i], slotOffsets[i + 1]);
    const ptc = computePtcIndicesJs(effectiveBalanceIncrements, slotIndices, slotSeed);
    result.set(ptc, i * PTC_SIZE);
  }
  return result;
}

describe("computePtcIndices - per slot", () => {
  for (const vc of [16_384, 250_000, 1_000_000]) {
    const seed = randomBytes(32);
    const indices = new Uint32Array(Array.from({length: vc}, (_, i) => i));
    const effectiveBalanceIncrements = new Uint16Array(vc).fill(32);

    bench({
      id: `JS - computePtcIndices - ${vc} indices`,
      fn: () => {
        computePtcIndicesJs(effectiveBalanceIncrements, indices, seed);
      },
    });

    bench({
      id: `RS - computePtcIndices - ${vc} indices`,
      fn: () => {
        computePtcIndices(
          seed,
          indices,
          effectiveBalanceIncrements,
          PTC_SIZE,
          MAX_EFFECTIVE_BALANCE_ELECTRA,
          EFFECTIVE_BALANCE_INCREMENT
        );
      },
    });
  }
});

describe("computePtcIndicesForEpoch - full epoch (32 slots)", () => {
  for (const vc of [250_000, 1_000_000]) {
    // Build a flat shuffling array and uniform slot offsets
    const shuffling = new Uint32Array(Array.from({length: vc}, (_, i) => i));
    const indicesPerSlot = Math.floor(vc / SLOTS_PER_EPOCH);
    const slotOffsets = new Uint32Array(SLOTS_PER_EPOCH + 1);
    for (let i = 0; i <= SLOTS_PER_EPOCH; i++) slotOffsets[i] = i * indicesPerSlot;
    const effectiveBalanceIncrements = new Uint16Array(vc).fill(32);
    const epochSeed = randomBytes(32);
    const startSlot = 0;

    bench({
      id: `JS - computePtcForEpoch - ${vc} validators`,
      fn: () => {
        computePtcForEpochJs(epochSeed, startSlot, shuffling, slotOffsets, effectiveBalanceIncrements);
      },
    });

    bench({
      id: `RS - computePtcIndicesForEpoch - ${vc} validators`,
      fn: () => {
        computePtcIndicesForEpoch(
          epochSeed,
          startSlot,
          SLOTS_PER_EPOCH,
          shuffling,
          slotOffsets,
          effectiveBalanceIncrements,
          PTC_SIZE,
          MAX_EFFECTIVE_BALANCE_ELECTRA,
          EFFECTIVE_BALANCE_INCREMENT
        );
      },
    });
  }
});
