import {randomBytes} from "node:crypto";
import {expect, describe, it} from "@jest/globals";
import * as referenceImplementation from "./referenceImplementation";
import {shuffleList, asyncShuffleList, unshuffleList, asyncUnshuffleList} from "../index";

interface ShuffleTestCase {
  id: string;
  rounds: number;
  seed: Uint8Array;
  input: Uint32Array;
  shuffled: string;
  unshuffled: string;
}

function fromHex(hex: string): Uint8Array {
  if (typeof hex !== "string") {
    throw new Error(`hex argument type ${typeof hex} must be of type string`);
  }

  if (hex.startsWith("0x")) {
    hex = hex.slice(2);
  }

  if (hex.length % 2 !== 0) {
    throw new Error(`hex string length ${hex.length} must be multiple of 2`);
  }

  const b = Buffer.from(hex, "hex");
  return new Uint8Array(b.buffer, b.byteOffset, b.length);
}

function getInputArray(count: number): Uint32Array {
  return Uint32Array.from(Array.from({length: count}, (_, i) => i));
}

function buildReferenceTestCase(count: number, rounds: number): ShuffleTestCase {
  const seed = randomBytes(32);
  const input = getInputArray(count);
  const shuffled = input.slice();
  referenceImplementation.shuffleList(shuffled, seed, rounds);
  const unshuffled = input.slice();
  referenceImplementation.unshuffleList(unshuffled, seed, rounds);
  return {
    id: `TestCase for ${count} indices with seed of $0x${seed.toString("hex")}`,
    seed,
    rounds,
    input,
    shuffled: Buffer.from(shuffled).toString("hex"),
    unshuffled: Buffer.from(unshuffled).toString("hex"),
  };
}

describe("util / shuffle", () => {
  it("should match spec test results", () => {
    const seed = "0x4fe91d85d6bc19b20413659c61f3c690a1c4d48be41cab8363a130cebabada97";
    const rounds = 10;
    const expected = Buffer.from([
      99, 71, 51, 5, 78, 61, 12, 17, 30, 3, 59, 47, 6, 9, 1, 41, 18, 37, 55, 43, 20, 31, 38, 79, 29, 69, 70, 54, 53, 36,
      34, 62, 77, 87, 39, 96, 56, 92, 16, 82, 40, 27, 58, 14, 68, 76, 80, 13, 28, 81, 64, 26, 19, 60, 90, 2, 98, 67, 66,
      52, 46, 95, 49, 72, 8, 21, 75, 57, 97, 83, 84, 88, 86, 7, 74, 32, 63, 85, 23, 65, 24, 91, 0, 48, 35, 15, 44, 25,
      22, 73, 93, 45, 4, 33, 89, 94, 10, 42, 11, 50,
    ]).toString("hex");

    const result = unshuffleList(getInputArray(100), fromHex(seed), rounds);

    expect(Buffer.from(result).toString("hex")).toEqual(expected);
  });

  const testCases: ShuffleTestCase[] = [buildReferenceTestCase(8, 10), buildReferenceTestCase(16, 10)];
  it.each(testCases)("$id", async ({seed, rounds, input, shuffled, unshuffled}) => {
    const unshuffledResult = unshuffleList(input, seed, rounds);
    const shuffledResult = shuffleList(input, seed, rounds);
    expect(Buffer.from(shuffledResult).toString("hex")).toEqual(shuffled);
    expect(Buffer.from(unshuffledResult).toString("hex")).toEqual(unshuffled);
  });
});
