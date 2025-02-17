#![deny(clippy::all)]

use std::{cmp::max, collections::HashMap, mem};

use napi::{
  bindgen_prelude::{AsyncTask, Result, Uint32Array, Uint8Array},
  Env, Task,
};
use napi_derive::napi;

use ethereum_hashing::hash_fixed;
use ethereum_types::H256;

#[napi]
pub const SHUFFLE_ROUNDS_MINIMAL: u32 = 10;

#[napi]
pub const SHUFFLE_ROUNDS_MAINNET: u32 = 90;

const SEED_SIZE: usize = 32;
const ROUND_SIZE: usize = 1;
const POSITION_WINDOW_SIZE: usize = 4;
const PIVOT_VIEW_SIZE: usize = SEED_SIZE + ROUND_SIZE;
const TOTAL_SIZE: usize = SEED_SIZE + ROUND_SIZE + POSITION_WINDOW_SIZE;

pub enum ShufflingErrorCode {
  InvalidSeedLength,
  InvalidActiveIndicesLength,
  InvalidNumberOfRounds,
}

impl From<ShufflingErrorCode> for napi::Error {
  fn from(err: ShufflingErrorCode) -> Self {
    match err {
      ShufflingErrorCode::InvalidSeedLength => {
        napi::Error::from_reason("Shuffling seed must be 32 bytes long")
      }
      ShufflingErrorCode::InvalidActiveIndicesLength => {
        napi::Error::from_reason("ActiveIndices must fit in a u32")
      }
      ShufflingErrorCode::InvalidNumberOfRounds => {
        napi::Error::from_reason("Rounds must be between 0 and 255")
      }
    }
  }
}

/// A helper struct to manage the buffer used during shuffling.
struct ShufflingManager([u8; TOTAL_SIZE]);

impl ShufflingManager {
  /// Create a new buffer from the given `seed`.
  fn new(seed: &[u8]) -> Result<Self> {
    // Rust panics if `seed.len() != 32`. Must pre check this and return a proper
    // error to JS before getting here (or kablooeee)!!!!
    if seed.len() != 32 {
      return Err(ShufflingErrorCode::InvalidSeedLength.into());
    }
    let mut buf = [0; TOTAL_SIZE];
    buf[0..SEED_SIZE].copy_from_slice(seed);
    Ok(Self(buf))
  }

  /// Set the shuffling round.
  fn set_round(&mut self, round: u8) {
    self.0[SEED_SIZE] = round;
  }

  /// Returns the new pivot. It is "raw" because it has not modulo the list size (this must be
  /// done by the caller).
  fn raw_pivot(&self) -> u64 {
    let digest = hash_fixed(&self.0[0..PIVOT_VIEW_SIZE]);

    let mut bytes = [0; mem::size_of::<u64>()];
    bytes[..].copy_from_slice(&digest[0..mem::size_of::<u64>()]);
    u64::from_le_bytes(bytes)
  }

  /// Add the current position into the buffer.
  fn mix_in_position(&mut self, position: usize) {
    self.0[PIVOT_VIEW_SIZE..].copy_from_slice(&position.to_le_bytes()[0..POSITION_WINDOW_SIZE]);
  }

  /// Hash the entire buffer.
  fn hash(&self) -> H256 {
    H256::from_slice(&hash_fixed(&self.0))
  }
}

/// Shuffles an entire list in-place.
///
/// Note: this is equivalent to the `compute_shuffled_index` function, except it shuffles an entire
/// list not just a single index. With large lists this function has been observed to be 250x
/// faster than running `compute_shuffled_index` across an entire list.
///
/// Credits to [@protolambda](https://github.com/protolambda) for defining this algorithm.
///
/// Shuffles if `forwards == true`, otherwise un-shuffles.
/// It holds that: shuffle_list(shuffle_list(l, r, s, true), r, s, false) == l
///           and: shuffle_list(shuffle_list(l, r, s, false), r, s, true) == l
///
/// The Eth2.0 spec mostly uses shuffling with `forwards == false`, because backwards
/// shuffled lists are slightly easier to specify, and slightly easier to compute.
///
/// The forwards shuffling of a list is equivalent to:
///
/// `[indices[x] for i in 0..n, where compute_shuffled_index(x) = i]`
///
/// Whereas the backwards shuffling of a list is:
///
/// `[indices[compute_shuffled_index(i)] for i in 0..n]`
///
/// Returns `None` under any of the following conditions:
///  - `list_size == 0`
///  - `list_size > 2**24`
///  - `list_size > usize::MAX / 2`
fn inner_shuffle_list(
  mut input: Vec<u32>,
  seed: &[u8],
  rounds: i32,
  forwards: bool,
) -> Result<Vec<u32>> {
  if rounds == 0 {
    // no shuffling rounds
    return Ok(input);
  }

  let list_size = input.len();

  if list_size <= 1 {
    // nothing to (un)shuffle
    return Ok(input);
  }

  // ensure length of array fits in u32 or will panic
  if list_size > u32::MAX as usize {
    // TODO: (@matthewkeil) found this in the rust implementation but not sure why...
    // || list_size < 2_usize.pow(24)
    return Err(ShufflingErrorCode::InvalidActiveIndicesLength.into());
  }

  let mut manager = ShufflingManager::new(seed)?;

  if rounds < u8::MIN.into() || rounds > u8::MAX.into() {
    return Err(ShufflingErrorCode::InvalidNumberOfRounds.into());
  }

  let mut current_round = if forwards { 0 } else { rounds as u8 - 1 };

  loop {
    manager.set_round(current_round);

    // get raw pivot and modulo by list size to account for wrap around to guarantee pivot is within length
    let pivot = manager.raw_pivot() as usize % list_size;

    // cut range in half
    let mirror = (pivot + 1) >> 1;

    manager.mix_in_position(pivot >> 8);
    let mut source = manager.hash();
    let mut byte_v = source[(pivot & 0xff) >> 3];

    // swap-or-not from beginning of list to mirror point
    for i in 0..mirror {
      let j = pivot - i;

      if j & 0xff == 0xff {
        manager.mix_in_position(j >> 8);
        source = manager.hash();
      }

      if j & 0x07 == 0x07 {
        byte_v = source[(j & 0xff) >> 3];
      }
      let bit_v = (byte_v >> (j & 0x07)) & 0x01;

      if bit_v == 1 {
        input.swap(i, j);
      }
    }

    // reset mirror to middle of opposing section of pivot
    let mirror = (pivot + list_size + 1) >> 1;
    let end = list_size - 1;

    manager.mix_in_position(end >> 8);
    let mut source = manager.hash();
    let mut byte_v = source[(end & 0xff) >> 3];

    // swap-or-not from pivot to mirror
    for (loop_iter, i) in ((pivot + 1)..mirror).enumerate() {
      let j = end - loop_iter;

      if j & 0xff == 0xff {
        manager.mix_in_position(j >> 8);
        source = manager.hash();
      }

      if j & 0x07 == 0x07 {
        byte_v = source[(j & 0xff) >> 3];
      }
      let bit_v = (byte_v >> (j & 0x07)) & 0x01;

      if bit_v == 1 {
        input.swap(i, j);
      }
    }

    // update currentRound and stop when reach end of predetermined rounds
    // println!("current_round = {}", current_round);
    if forwards {
      current_round += 1;
      if current_round == rounds as u8 {
        break;
      }
    } else {
      if current_round == 0 {
        break;
      }
      current_round -= 1;
    }
    // println!("current_round = {}", current_round);
  }

  Ok(input)
}

#[napi]
pub fn shuffle_list(
  active_indices: Uint32Array,
  seed: Uint8Array,
  rounds: i32,
) -> Result<Uint32Array> {
  Ok(Uint32Array::new(inner_shuffle_list(
    active_indices.to_vec(),
    &seed,
    rounds,
    true,
  )?))
}

#[napi]
pub fn unshuffle_list(
  active_indices: Uint32Array,
  seed: Uint8Array,
  rounds: i32,
) -> Result<Uint32Array> {
  Ok(Uint32Array::new(inner_shuffle_list(
    active_indices.to_vec(),
    &seed,
    rounds,
    false,
  )?))
}

pub struct AsyncInnerShuffle {
  input: Uint32Array,
  seed: Vec<u8>,
  rounds: i32,
  forwards: bool,
}

#[napi]
impl Task for AsyncInnerShuffle {
  type Output = Vec<u32>;
  type JsValue = Uint32Array;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(inner_shuffle_list(
      self.input.to_vec(),
      &self.seed,
      self.rounds,
      self.forwards,
    )?)
  }

  fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(Uint32Array::new(output))
  }
}

#[napi]
pub fn async_shuffle_list(
  active_indices: Uint32Array,
  seed: Uint8Array,
  rounds: i32,
) -> AsyncTask<AsyncInnerShuffle> {
  AsyncTask::new(AsyncInnerShuffle {
    input: active_indices,
    seed: seed.to_vec(),
    rounds,
    forwards: true,
  })
}

#[napi]
pub fn async_unshuffle_list(
  active_indices: Uint32Array,
  seed: Uint8Array,
  rounds: i32,
) -> AsyncTask<AsyncInnerShuffle> {
  AsyncTask::new(AsyncInnerShuffle {
    input: active_indices,
    seed: seed.to_vec(),
    rounds,
    forwards: false,
  })
}

#[napi]
pub struct ComputeShuffledIndex {
  /// There are possibly SHUFFLE_ROUND_COUNT (90) values for this cache
  /// This cache will always hit after the 1st call
  pivot_by_index: HashMap<u32, u32>,
  /// Given 2M active validators, there are 2M / 256 = 8k possible position_div
  /// It means there are at most 8k different sources for each round
  source_by_position_by_index: HashMap<u32, HashMap<u32, [u8; 32]>>,
  /// 32 bytes seed + 1 byte i
  pivot_buffer: [u8; 32 + 1],
  /// 32 bytes seed + 1 byte i + 4 bytes position_div
  source_buffer: [u8; 32 + 1 + 4],
  /// validator count
  index_count: u32,
  /// rounds
  rounds: u32,
}

fn digest_as_u64(input: &[u8]) -> u64 {
  u64::from_le_bytes(hash_fixed(input)[0..8].try_into().unwrap())
}

#[napi]
impl ComputeShuffledIndex {
  #[napi(constructor)]
  pub fn new(seed: &[u8], index_count: u32, rounds: u32) -> Self {
    // copy seed into the front of pivot_buffer and source_buffer
    let mut pivot_buffer = [0u8; 32 + 1];
    pivot_buffer[0..32].copy_from_slice(seed);
    let mut source_buffer = [0u8; 32 + 1 + 4];
    source_buffer[0..32].copy_from_slice(seed);
    Self {
      pivot_by_index: HashMap::new(),
      source_by_position_by_index: HashMap::new(),
      pivot_buffer,
      source_buffer,
      index_count,
      rounds,
    }
  }

  #[napi]
  pub fn get(&mut self, index: u32) -> u32 {
    let mut permuted = index;

    for i in 0..self.rounds {
      let pivot = *self.pivot_by_index.entry(i).or_insert_with(|| {
        self.pivot_buffer[32] = (i % 256) as u8;
        (digest_as_u64(self.pivot_buffer.as_ref()) % self.index_count as u64)
          .try_into()
          .unwrap()
      });

      let flip = (pivot + self.index_count - permuted) % self.index_count;
      let position = max(permuted, flip);

      let position_div = position / 256;
      let source = self
        .source_by_position_by_index
        .entry(i)
        .or_insert(HashMap::new())
        .entry(position_div)
        .or_insert_with(|| {
          self.source_buffer[32] = (i % 256) as u8;
          self.source_buffer[33..37].copy_from_slice(&position_div.to_le_bytes());
          hash_fixed(self.source_buffer.as_ref())
        });

      let byte = source[(position % 256 / 8) as usize];
      let bit = (byte >> (position % 8)) & 1;
      permuted = if bit == 1 { flip } else { permuted };
    }

    permuted
  }
}

#[napi]
pub fn compute_proposer_index_electra(
  effective_balance_increments: &[u16],
  active_indices: &[u32],
  seed: &[u8],
  max_effective_balance_electra: i64,
  effective_balance_increment: i64,
  rounds: u32,
) -> u32 {
  get_committee_indices_electra(
    1,
    seed,
    active_indices,
    effective_balance_increments,
    max_effective_balance_electra,
    effective_balance_increment,
    rounds,
  )[0]
}

#[napi]
pub fn compute_sync_committee_indices_electra(
  sync_committee_size: u32,
  seed: &[u8],
  active_indices: &[u32],
  effective_balance_increments: &[u16],
  max_effective_balance_electra: i64,
  effective_balance_increment: i64,
  rounds: u32,
) -> Uint32Array {
  get_committee_indices_electra(
    sync_committee_size,
    seed,
    active_indices,
    effective_balance_increments,
    max_effective_balance_electra,
    effective_balance_increment,
    rounds,
  ).into()
}

pub fn get_committee_indices_electra(
  committee_size: u32,
  seed: &[u8],
  active_indices: &[u32],
  effective_balance_increments: &[u16],
  max_effective_balance_electra: i64,
  effective_balance_increment: i64,
  rounds: u32,
) -> Vec<u32> {
  let mut committee_indices = Vec::with_capacity(committee_size as usize);
  let max_random_value = 0xffff;
  let max_effective_balance_increment = max_effective_balance_electra / effective_balance_increment;

  let mut compute_shuffled_index =
    ComputeShuffledIndex::new(seed, active_indices.len() as u32, rounds);
  let mut shuffled_result = HashMap::new();

  let mut i: u32 = 0;
  let mut cached_hash_input = [0u8; 32 + 8];
  cached_hash_input[0..32].copy_from_slice(seed);
  let mut cached_hash = [0u8; 32];

  while (committee_indices.len() as u32) < committee_size {
    let index = i % active_indices.len() as u32;
    let shuffled_index = *shuffled_result
      .entry(index)
      .or_insert_with(|| compute_shuffled_index.get(index));
    let candidate_index = active_indices[shuffled_index as usize];

    if i % 16 == 0 {
      cached_hash_input[32..36].copy_from_slice(&(i / 16).to_le_bytes());
      cached_hash = hash_fixed(&cached_hash_input);
    }

    let random_bytes = cached_hash;
    let offset = ((i % 16) * 2) as usize;
    let random_value =
      u16::from_le_bytes(random_bytes[offset..(offset + 2)].try_into().unwrap()) as i64;

    let effective_balance_increment = effective_balance_increments[candidate_index as usize] as i64;

    if effective_balance_increment * max_random_value
      >= max_effective_balance_increment * random_value
    {
      committee_indices.push(candidate_index);
    }

    i += 1;
  }
  committee_indices
}
