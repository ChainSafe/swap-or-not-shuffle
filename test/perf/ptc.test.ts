import {randomBytes} from "node:crypto";
import {bench, describe} from "@chainsafe/benchmark";
import {EFFECTIVE_BALANCE_INCREMENT, MAX_EFFECTIVE_BALANCE_ELECTRA, SLOTS_PER_EPOCH} from "@lodestar/params";
import {computePtcIndices, computePtcIndicesForEpoch} from "../../index.js";
import {
  naiveComputePayloadTimelinessCommitteeIndices,
  naiveComputePayloadTimelinessCommitteesForEpoch,
} from "../referenceImplementation.js";

const PTC_SIZE = 512;

describe("computePtcIndices - per slot", () => {
  for (const vc of [16_384, 250_000, 1_000_000]) {
    const seed = randomBytes(32);
    const indices = new Uint32Array(Array.from({length: vc}, (_, i) => i));
    const effectiveBalanceIncrements = new Uint16Array(vc).fill(32);

    bench({
      id: `naive JS - computePtcIndices - ${vc} indices`,
      fn: () => {
        naiveComputePayloadTimelinessCommitteeIndices(effectiveBalanceIncrements, indices, seed);
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
    const shuffling = new Uint32Array(Array.from({length: vc}, (_, i) => i));
    const indicesPerSlot = Math.floor(vc / SLOTS_PER_EPOCH);
    const slotOffsets = new Uint32Array(SLOTS_PER_EPOCH + 1);
    for (let i = 0; i <= SLOTS_PER_EPOCH; i++) slotOffsets[i] = i * indicesPerSlot;
    const effectiveBalanceIncrements = new Uint16Array(vc).fill(32);
    const epochSeed = randomBytes(32);
    const startSlot = 0;

    const committees: Uint32Array[][] = new Array(SLOTS_PER_EPOCH);
    for (let i = 0; i < SLOTS_PER_EPOCH; i++) {
      committees[i] = [shuffling.subarray(slotOffsets[i], slotOffsets[i + 1])];
    }

    bench({
      id: `naive JS - computePtcForEpoch - ${vc} validators`,
      fn: () => {
        naiveComputePayloadTimelinessCommitteesForEpoch(epochSeed, startSlot, committees, effectiveBalanceIncrements);
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
