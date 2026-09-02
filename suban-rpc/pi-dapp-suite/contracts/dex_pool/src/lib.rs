#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env, Symbol,
};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Initialized,
    Admin,
    TokenA,
    TokenB,
    ReserveA,
    ReserveB,
    TotalShares,
    Share(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PoolError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    BadToken = 3,
    InsufficientLiquidity = 4,
    Slippage = 5,
}

fn read_i128(env: &Env, key: &DataKey) -> i128 {
    env.storage().instance().get(key).unwrap_or(0)
}

fn read_share(env: &Env, user: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Share(user.clone()))
        .unwrap_or(0)
}

fn write_share(env: &Env, user: &Address, amount: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::Share(user.clone()), &amount);
}

#[contract]
pub struct DexPoolContract;

#[contractimpl]
impl DexPoolContract {
    pub fn init(env: Env, admin: Address, token_a: Address, token_b: Address) {
        if env.storage().instance().has(&DataKey::Initialized) {
            panic_with_error!(&env, PoolError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TokenA, &token_a);
        env.storage().instance().set(&DataKey::TokenB, &token_b);
        env.storage().instance().set(&DataKey::ReserveA, &0_i128);
        env.storage().instance().set(&DataKey::ReserveB, &0_i128);
        env.storage().instance().set(&DataKey::TotalShares, &0_i128);
    }

    pub fn add_liquidity(env: Env, provider: Address, amount_a: i128, amount_b: i128) -> i128 {
        provider.require_auth();
        let reserve_a = read_i128(&env, &DataKey::ReserveA);
        let reserve_b = read_i128(&env, &DataKey::ReserveB);
        let total_shares = read_i128(&env, &DataKey::TotalShares);

        // Simple scaffold minting rule for testing:
        // initial shares = a+b, next shares proportional to reserve growth.
        let minted = if total_shares == 0 {
            amount_a + amount_b
        } else {
            let by_a = amount_a * total_shares / reserve_a.max(1);
            let by_b = amount_b * total_shares / reserve_b.max(1);
            if by_a < by_b { by_a } else { by_b }
        };

        env.storage()
            .instance()
            .set(&DataKey::ReserveA, &(reserve_a + amount_a));
        env.storage()
            .instance()
            .set(&DataKey::ReserveB, &(reserve_b + amount_b));
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &(total_shares + minted));
        write_share(&env, &provider, read_share(&env, &provider) + minted);

        env.events()
            .publish((Symbol::new(&env, "add_liquidity"), provider), (amount_a, amount_b, minted));
        minted
    }

    pub fn remove_liquidity(env: Env, provider: Address, share_amount: i128) -> (i128, i128) {
        provider.require_auth();
        let user_share = read_share(&env, &provider);
        if user_share < share_amount {
            panic_with_error!(&env, PoolError::InsufficientLiquidity);
        }

        let reserve_a = read_i128(&env, &DataKey::ReserveA);
        let reserve_b = read_i128(&env, &DataKey::ReserveB);
        let total_shares = read_i128(&env, &DataKey::TotalShares).max(1);

        let out_a = reserve_a * share_amount / total_shares;
        let out_b = reserve_b * share_amount / total_shares;

        write_share(&env, &provider, user_share - share_amount);
        env.storage().instance().set(&DataKey::ReserveA, &(reserve_a - out_a));
        env.storage().instance().set(&DataKey::ReserveB, &(reserve_b - out_b));
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &(total_shares - share_amount));

        env.events()
            .publish((Symbol::new(&env, "remove_liquidity"), provider), (out_a, out_b, share_amount));
        (out_a, out_b)
    }

    // Short symbol names for cross-contract calls (Symbol max 9 chars in short form usage).
    pub fn quote_in(env: Env, token_in: Address, amount_in: i128) -> i128 {
        let token_a: Address = env.storage().instance().get(&DataKey::TokenA).unwrap();
        let token_b: Address = env.storage().instance().get(&DataKey::TokenB).unwrap();
        let reserve_a = read_i128(&env, &DataKey::ReserveA);
        let reserve_b = read_i128(&env, &DataKey::ReserveB);
        if reserve_a == 0 || reserve_b == 0 {
            return 0;
        }

        let amount_in_with_fee = amount_in * 997 / 1000;
        if token_in == token_a {
            (amount_in_with_fee * reserve_b) / (reserve_a + amount_in_with_fee)
        } else if token_in == token_b {
            (amount_in_with_fee * reserve_a) / (reserve_b + amount_in_with_fee)
        } else {
            panic_with_error!(&env, PoolError::BadToken);
        }
    }

    pub fn swap_in(env: Env, trader: Address, token_in: Address, amount_in: i128, min_out: i128) -> i128 {
        trader.require_auth();
        let out = Self::quote_in(env.clone(), token_in.clone(), amount_in);
        if out < min_out {
            panic_with_error!(&env, PoolError::Slippage);
        }

        let token_a: Address = env.storage().instance().get(&DataKey::TokenA).unwrap();
        let reserve_a = read_i128(&env, &DataKey::ReserveA);
        let reserve_b = read_i128(&env, &DataKey::ReserveB);
        if token_in == token_a {
            env.storage().instance().set(&DataKey::ReserveA, &(reserve_a + amount_in));
            env.storage().instance().set(&DataKey::ReserveB, &(reserve_b - out));
        } else {
            env.storage().instance().set(&DataKey::ReserveB, &(reserve_b + amount_in));
            env.storage().instance().set(&DataKey::ReserveA, &(reserve_a - out));
        }
        env.events()
            .publish((Symbol::new(&env, "swap"), trader, token_in), (amount_in, out));
        out
    }

    pub fn reserves(env: Env) -> (Address, Address, i128, i128, i128) {
        (
            env.storage().instance().get(&DataKey::TokenA).unwrap(),
            env.storage().instance().get(&DataKey::TokenB).unwrap(),
            read_i128(&env, &DataKey::ReserveA),
            read_i128(&env, &DataKey::ReserveB),
            read_i128(&env, &DataKey::TotalShares),
        )
    }
}

